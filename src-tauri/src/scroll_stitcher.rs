use fast_image_resize::{images::Image, PixelType, ResizeAlg, ResizeOptions, Resizer};
use hora::core::ann_index::ANNIndex;
use hora::core::metrics::Metric;
use hora::index::{hnsw_idx::HNSWIndex, hnsw_params::HNSWParams};
use image::{DynamicImage, GrayImage, RgbaImage};
use imageproc::corners;
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};

const FEATURE_AXIS_TOLERANCE: i32 = 2;
const FEATURE_DISTANCE_THRESHOLD: f32 = 0.18;

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum ScrollDirection {
    Vertical = 0,
    Horizontal = 1,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum ScrollImageList {
    Top = 0,
    Bottom = 1,
}

#[derive(Debug, Clone, Copy, Eq, Hash, PartialEq)]
pub struct ScrollOffset {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy)]
pub struct CropRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
struct OverlapCandidate {
    overlap: u32,
    unique_height: u32,
    row_score: f64,
    template_corr: Option<f64>,
    adjusted_score: f64,
}

impl CropRegion {
    fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[derive(Debug)]
pub struct ScrollIndex {
    pub position: i32,
    pub ann_index: HNSWIndex<f32, usize>,
    pub corners: Vec<ScrollOffset>,
    pub descriptors: Vec<Vec<f32>>,
}

impl ScrollIndex {
    fn new(dimension: usize) -> Self {
        let mut index_params = HNSWParams::<f32>::default();
        index_params.ef_search = 24;
        index_params.ef_build = 12;

        Self {
            position: 0,
            ann_index: HNSWIndex::new(dimension, &index_params),
            corners: vec![],
            descriptors: vec![],
        }
    }
}

pub struct ScrollImage {
    pub image: DynamicImage,
    pub overlay_size: i32,
}

pub struct ScrollScreenshotService {
    pub top_image_list: Vec<ScrollImage>,
    pub bottom_image_list: Vec<ScrollImage>,
    pub current_direction: ScrollDirection,
    pub image_width: u32,
    pub image_height: u32,
    pub top_image_size: i32,
    pub top_image_index_size: i32,
    pub bottom_image_size: i32,
    pub bottom_image_index_size: i32,
    pub image_scale: f32,
    pub image_resizer: Resizer,
    pub corner_threshold: u8,
    pub descriptor_patch_size: usize,
    pub top_image_ann_index: ScrollIndex,
    pub bottom_image_ann_index: ScrollIndex,
    pub min_size_delta: i32,
    pub image_dst_width: u32,
    pub image_dst_height: u32,
    pub image_scroll_side_size: i32,
    pub enable_corner_fast12: Option<bool>,
    pub try_rollback: bool,
    pub sample_rate: f32,
    pub min_sample_size: u32,
    pub max_sample_size: u32,
    pub last_full_image: Option<DynamicImage>,
    pub last_append_size: Option<u32>,
}

impl ScrollScreenshotService {
    pub fn new() -> Self {
        Self {
            top_image_list: vec![],
            bottom_image_list: vec![],
            current_direction: ScrollDirection::Vertical,
            image_width: 0,
            image_height: 0,
            top_image_size: 0,
            top_image_index_size: 0,
            bottom_image_size: 0,
            bottom_image_index_size: 0,
            image_scale: 1.0,
            image_resizer: Resizer::new(),
            corner_threshold: 24,
            descriptor_patch_size: 28,
            min_size_delta: 64,
            image_dst_width: 0,
            image_dst_height: 0,
            image_scroll_side_size: 0,
            top_image_ann_index: ScrollIndex::new(0),
            bottom_image_ann_index: ScrollIndex::new(0),
            enable_corner_fast12: None,
            try_rollback: true,
            sample_rate: 1.0,
            min_sample_size: 128,
            max_sample_size: 128,
            last_full_image: None,
            last_append_size: None,
        }
    }

    pub fn init_for_region(&mut self, width: u32, height: u32) {
        let min_size_delta = (if self.current_direction == ScrollDirection::Horizontal {
            width
        } else {
            height
        } as f32
            * 0.8)
            .ceil() as i32;

        self.init(
            ScrollDirection::Vertical,
            1.0,
            128,
            128,
            24,
            28,
            min_size_delta,
            false,
        );
    }

    fn get_descriptor_size(&self) -> usize {
        self.descriptor_patch_size & !1
    }

    fn compute_descriptor(&self, img: &GrayImage, corner: &ScrollOffset) -> Vec<f32> {
        let descriptor_size = self.descriptor_patch_size;
        let mut descriptor = Vec::with_capacity(self.get_descriptor_size());
        let half_size = descriptor_size as i32 / 2;

        let width = img.width() as i32;
        let height = img.height() as i32;

        for row in 0..(descriptor_size / 2) {
            let y = corner.y + (-half_size + row as i32 * 2);
            let mut sum = 0.0;
            let mut valid_pixels = 0;

            for col in 0..(descriptor_size / 2) {
                let x = corner.x + (-half_size + col as i32 * 2);
                if x >= 0 && x < width && y >= 0 && y < height {
                    let pixel = img.get_pixel(x as u32, y as u32);
                    sum += pixel[0] as f32 / 255.0;
                    valid_pixels += 1;
                }
            }

            descriptor.push(if valid_pixels > 0 {
                sum / valid_pixels as f32
            } else {
                0.0
            });
        }

        for col in 0..(descriptor_size / 2) {
            let x = corner.x + (-half_size + col as i32 * 2);
            let mut sum = 0.0;
            let mut valid_pixels = 0;

            for row in 0..(descriptor_size / 2) {
                let y = corner.y + (-half_size + row as i32 * 2);
                if x >= 0 && x < width && y >= 0 && y < height {
                    let pixel = img.get_pixel(x as u32, y as u32);
                    sum += pixel[0] as f32 / 255.0;
                    valid_pixels += 1;
                }
            }

            descriptor.push(if valid_pixels > 0 {
                sum / valid_pixels as f32
            } else {
                0.0
            });
        }

        descriptor
    }

    fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
        a.iter()
            .zip(b.iter())
            .map(|(x, y)| (x - y).powi(2))
            .sum::<f32>()
            .sqrt()
    }

    #[allow(dead_code)]
    pub fn clear(&mut self) {
        self.top_image_list.clear();
        self.bottom_image_list.clear();
        self.top_image_ann_index = ScrollIndex::new(0);
        self.bottom_image_ann_index = ScrollIndex::new(0);
        self.last_full_image = None;
        self.last_append_size = None;
    }

    pub fn init(
        &mut self,
        direction: ScrollDirection,
        sample_rate: f32,
        min_sample_size: u32,
        max_sample_size: u32,
        corner_threshold: u8,
        descriptor_patch_size: usize,
        min_size_delta: i32,
        try_rollback: bool,
    ) {
        self.top_image_list.clear();
        self.bottom_image_list.clear();
        self.current_direction = direction;
        self.image_width = 0;
        self.image_height = 0;
        self.top_image_size = 0;
        self.bottom_image_size = 0;
        self.corner_threshold = corner_threshold;
        self.descriptor_patch_size = descriptor_patch_size;
        self.min_size_delta = min_size_delta;
        self.top_image_index_size = 0;
        self.bottom_image_index_size = 0;
        self.top_image_ann_index = ScrollIndex::new(self.get_descriptor_size());
        self.bottom_image_ann_index = ScrollIndex::new(self.get_descriptor_size());
        self.try_rollback = try_rollback;
        self.enable_corner_fast12 = None;
        self.sample_rate = sample_rate;
        self.min_sample_size = min_sample_size;
        self.max_sample_size = max_sample_size;
        self.last_full_image = None;
        self.last_append_size = None;
    }

    fn init_image_size(&mut self, image_width: u32, image_height: u32) {
        self.image_width = image_width;
        self.image_height = image_height;

        let image_scale_side_size = if self.current_direction == ScrollDirection::Vertical {
            image_width as f32
        } else {
            image_height as f32
        };

        let target_side_size = (image_scale_side_size * self.sample_rate)
            .min(self.max_sample_size as f32)
            .max(self.min_sample_size as f32);

        self.image_scale = (target_side_size / image_scale_side_size).min(1.0);

        if self.current_direction == ScrollDirection::Vertical {
            self.image_dst_width = (image_width as f32 * self.image_scale) as u32;
            self.image_dst_height = image_height;
        } else {
            self.image_dst_width = image_width;
            self.image_dst_height = (image_height as f32 * self.image_scale) as u32;
        }

        self.image_scroll_side_size = if self.current_direction == ScrollDirection::Vertical {
            self.image_height as i32
        } else {
            self.image_width as i32
        };
    }

    fn get_descriptors(&self, image: &GrayImage, corners: &[ScrollOffset]) -> Vec<Vec<f32>> {
        corners
            .par_iter()
            .map(|corner| self.compute_descriptor(image, corner))
            .collect()
    }

    fn get_gray_image(&mut self, image: &DynamicImage) -> GrayImage {
        let image_width = image.width();
        let image_height = image.height();
        let mut gray_image = image.to_luma8();

        if self.image_scale >= 1.0 {
            return gray_image;
        }

        let src_image = Image::from_slice_u8(
            image_width,
            image_height,
            gray_image.as_mut(),
            PixelType::U8,
        )
        .unwrap();

        let mut dst_image = Image::new(self.image_dst_width, self.image_dst_height, PixelType::U8);

        self.image_resizer
            .resize(
                &src_image,
                &mut dst_image,
                &ResizeOptions::new().resize_alg(ResizeAlg::Nearest),
            )
            .unwrap();

        GrayImage::from_vec(
            self.image_dst_width,
            self.image_dst_height,
            dst_image.into_vec(),
        )
        .unwrap()
    }

    fn get_crop_region(&self, delta_size: i32) -> CropRegion {
        let image_width = self.image_width;
        let image_height = self.image_height;

        if self.current_direction == ScrollDirection::Vertical {
            let start_position = image_height - delta_size.abs() as u32;
            if delta_size > 0 {
                CropRegion::new(
                    0,
                    start_position,
                    image_width,
                    image_height - start_position,
                )
            } else {
                CropRegion::new(0, 0, image_width, image_height - start_position)
            }
        } else {
            let start_position = image_width - delta_size.abs() as u32;
            if start_position > 0 {
                CropRegion::new(
                    start_position,
                    0,
                    image_width - start_position,
                    image_height,
                )
            } else {
                CropRegion::new(0, 0, image_width - start_position, image_height)
            }
        }
    }

    fn get_corners(&mut self, image: &GrayImage) -> Vec<ScrollOffset> {
        let corners = if self.enable_corner_fast12.is_none() {
            let fast12_corners = corners::corners_fast12(image, self.corner_threshold);
            if fast12_corners.len() > 200 {
                self.enable_corner_fast12 = Some(true);
                fast12_corners
            } else {
                self.enable_corner_fast12 = Some(false);
                corners::corners_fast9(image, self.corner_threshold)
            }
        } else if self.enable_corner_fast12.unwrap() {
            corners::corners_fast12(image, self.corner_threshold)
        } else {
            corners::corners_fast9(image, self.corner_threshold)
        };

        corners
            .iter()
            .map(|corner| ScrollOffset {
                x: corner.x as i32,
                y: corner.y as i32,
            })
            .collect()
    }

    fn build_index(
        &mut self,
        gray_image: GrayImage,
        image_corners: &[ScrollOffset],
        edge_position: i32,
        index_edge_position_distance: i32,
    ) {
        let mut new_scroll_index = ScrollIndex::new(self.get_descriptor_size());
        new_scroll_index.descriptors = self.get_descriptors(&gray_image, image_corners);
        new_scroll_index.corners = image_corners.to_vec();

        new_scroll_index
            .descriptors
            .iter()
            .enumerate()
            .for_each(|(i, descriptor)| {
                new_scroll_index.ann_index.add(descriptor, i).unwrap();
            });

        new_scroll_index.ann_index.build(Metric::Euclidean).unwrap();

        let index_position = if edge_position > 0 {
            self.bottom_image_index_size - index_edge_position_distance
        } else {
            -(self.top_image_index_size - index_edge_position_distance)
        };

        new_scroll_index.position = index_position;

        if edge_position > 0 {
            self.bottom_image_ann_index = new_scroll_index;
        } else {
            self.top_image_ann_index = new_scroll_index;
        }
    }

    fn add_index(
        &mut self,
        image: DynamicImage,
        gray_image: GrayImage,
        image_corners: Vec<ScrollOffset>,
        edge_position: i32,
        delta_size: i32,
    ) -> (ScrollImage, i32) {
        let mut index_delta_size = 0;
        let image_scroll_side_size = self.image_scroll_side_size;

        let index_edge_position_distance = if delta_size > 0 {
            self.bottom_image_index_size - (edge_position - image_scroll_side_size)
        } else {
            self.top_image_index_size + edge_position
        };

        if index_edge_position_distance <= self.min_size_delta {
            index_delta_size = image_scroll_side_size - index_edge_position_distance;
            self.build_index(
                gray_image,
                &image_corners,
                edge_position,
                index_edge_position_distance,
            );
        }

        let image_overlay_size = (image_scroll_side_size / 2 - delta_size.abs()).max(0);
        let image_overlay_size = if delta_size > 0 {
            image_overlay_size
        } else {
            -image_overlay_size
        };

        let crop_region = self.get_crop_region(delta_size + image_overlay_size);

        (
            ScrollImage {
                image: image.crop_imm(
                    crop_region.x,
                    crop_region.y,
                    crop_region.width,
                    crop_region.height,
                ),
                overlay_size: image_overlay_size,
            },
            index_delta_size,
        )
    }

    fn push_image(
        &mut self,
        image: DynamicImage,
        gray_image: GrayImage,
        image_corners: Vec<ScrollOffset>,
        index_position: i32,
        origin_position: ScrollOffset,
        new_position: ScrollOffset,
    ) -> (i32, Option<ScrollImageList>) {
        let position_offset = if self.current_direction == ScrollDirection::Vertical {
            ScrollOffset {
                x: origin_position.x - new_position.x,
                y: origin_position.y - new_position.y + index_position,
            }
        } else {
            ScrollOffset {
                x: origin_position.x - new_position.x + index_position,
                y: origin_position.y - new_position.y,
            }
        };

        let image_scroll_side_size = self.image_scroll_side_size;

        let edge_position = if self.current_direction == ScrollDirection::Vertical {
            if position_offset.y >= 0 {
                position_offset.y + image_scroll_side_size
            } else {
                position_offset.y
            }
        } else if position_offset.x >= 0 {
            position_offset.x + image_scroll_side_size
        } else {
            position_offset.x
        };

        let (delta_size, is_bottom) = if edge_position >= 0
            && edge_position >= self.bottom_image_size
        {
            (edge_position - self.bottom_image_size, true)
        } else if edge_position < 0 && edge_position.abs() >= self.top_image_size {
            (edge_position + self.top_image_size, false)
        } else {
            println!(
                    "[long-screenshot][stitcher] no new region: edge={}, top_size={}, bottom_size={}, position_offset=({}, {})",
                    edge_position,
                    self.top_image_size,
                    self.bottom_image_size,
                    position_offset.x,
                    position_offset.y
            );
            return (edge_position, None);
        };

        if !is_bottom && self.current_direction == ScrollDirection::Vertical {
            println!(
                "[long-screenshot][stitcher] reject top append in downward capture: edge={}, delta={}",
                edge_position, delta_size
            );
            return (edge_position, None);
        }

        let abs_delta_size = delta_size.unsigned_abs();
        let max_global_delta = ((image_scroll_side_size as f32 * 0.75).round() as u32)
            .max(24)
            .min(image_scroll_side_size.saturating_sub(8) as u32);
        let max_expected_delta = self
            .last_append_size
            .map(|last_append_size| {
                ((last_append_size as f32 * 1.8).round() as u32)
                    .saturating_add(12)
                    .max(24)
                    .min(max_global_delta)
            })
            .unwrap_or(max_global_delta);

        if self.last_full_image.is_some() && abs_delta_size > max_expected_delta {
            println!(
                "[long-screenshot][stitcher] reject implausible feature delta: delta={}, max_expected={}, last_append={:?}, edge={}",
                abs_delta_size, max_expected_delta, self.last_append_size, edge_position
            );
            return (edge_position, None);
        }

        let (cropped_image, index_delta_size) =
            self.add_index(image, gray_image, image_corners, edge_position, delta_size);

        if is_bottom {
            self.bottom_image_list.push(cropped_image);
            self.bottom_image_size += delta_size;
            self.bottom_image_index_size += index_delta_size;
            self.last_append_size = Some(delta_size.unsigned_abs());
            println!(
                "[long-screenshot][stitcher] append bottom: edge={}, delta={}, bottom_size={}, index_delta={}",
                edge_position, delta_size, self.bottom_image_size, index_delta_size
            );

            (edge_position, Some(ScrollImageList::Bottom))
        } else {
            self.top_image_list.push(cropped_image);
            self.top_image_size -= delta_size;
            self.top_image_index_size += index_delta_size;
            self.last_append_size = Some(delta_size.unsigned_abs());
            println!(
                "[long-screenshot][stitcher] append top: edge={}, delta={}, top_size={}, index_delta={}",
                edge_position, delta_size, self.top_image_size, index_delta_size
            );

            (edge_position, Some(ScrollImageList::Top))
        }
    }

    fn get_offsets<'a>(
        &self,
        index: &'a ScrollIndex,
        image_descriptors: &[Vec<f32>],
        image_corners: &[ScrollOffset],
        scroll_image_list: ScrollImageList,
    ) -> (Option<(&'a ScrollIndex, usize, usize)>, bool) {
        let image_scroll_side_size = self.image_scroll_side_size;
        let min_diff = if scroll_image_list == ScrollImageList::Bottom {
            -(self.bottom_image_size - image_scroll_side_size + 1) + index.position
        } else {
            (self.top_image_size + 1) + index.position
        };

        let min_diff_count = AtomicUsize::new(0);

        let offsets: Vec<(i32, &'a ScrollIndex, usize, usize)> = image_descriptors
            .par_iter()
            .enumerate()
            .filter_map(|(i, descriptor)| {
                let search_result = index.ann_index.search(descriptor, 1);
                if search_result.is_empty() {
                    return None;
                }

                let idx1 = search_result[0];
                let dist = Self::euclidean_distance(&index.descriptors[idx1], descriptor);

                let point1 = &index.corners[idx1];
                let point2 = &image_corners[i];
                let dy = point2.y - point1.y;
                let dx = point2.x - point1.x;

                let diff = if self.current_direction == ScrollDirection::Vertical {
                    if dx.abs() > FEATURE_AXIS_TOLERANCE {
                        return None;
                    }
                    dy
                } else {
                    if dy.abs() > FEATURE_AXIS_TOLERANCE {
                        return None;
                    }
                    dx
                };

                if min_diff < 0 && min_diff < diff {
                    min_diff_count.fetch_add(1, Ordering::Relaxed);
                    return None;
                }

                if min_diff > 0 && min_diff > diff {
                    min_diff_count.fetch_add(1, Ordering::Relaxed);
                    return None;
                }

                if dist < FEATURE_DISTANCE_THRESHOLD {
                    Some((diff, index, idx1, i))
                } else {
                    None
                }
            })
            .collect();

        if min_diff_count.load(Ordering::Relaxed) > (image_corners.len() as f32 * 0.72) as usize {
            println!(
                "[long-screenshot][stitcher] origin detected by min_diff: min_diff_count={}, corners={}",
                min_diff_count.load(Ordering::Relaxed),
                image_corners.len()
            );
            return (None, true);
        }

        if offsets.is_empty() {
            println!(
                "[long-screenshot][stitcher] no offsets: corners={}, descriptors={}, axis_tolerance={}, distance_threshold={:.3}",
                image_corners.len(),
                image_descriptors.len(),
                FEATURE_AXIS_TOLERANCE,
                FEATURE_DISTANCE_THRESHOLD
            );
            return (None, false);
        }

        let mut offset_counts: HashMap<i32, (i32, &ScrollIndex, usize, usize)> = HashMap::new();
        for (offset, scroll_index, origin_position_index, new_position_index) in offsets {
            if let Some(value) = offset_counts.get_mut(&offset) {
                value.0 += 1;
            } else {
                offset_counts.insert(
                    offset,
                    (1, scroll_index, origin_position_index, new_position_index),
                );
            }
        }

        let mut max_count = 0;
        let mut second_max_count = 0;
        let mut max_offset = None;

        for (_, (count, scroll_index, origin_idx, new_idx)) in &offset_counts {
            if *count > max_count {
                second_max_count = max_count;
                max_count = *count;
                max_offset = Some((scroll_index, origin_idx, new_idx));
            } else if *count > second_max_count {
                second_max_count = *count;
            }
        }

        let max_offset = match max_offset {
            Some(offset) => offset,
            None => return (None, false),
        };

        let min_match_count = ((image_corners.len() as f32 * 0.035).ceil() as i32).max(6);
        if max_count < min_match_count {
            println!(
                "[long-screenshot][stitcher] dominant offset too weak: max_count={}, min_match_count={}, corners={}",
                max_count, min_match_count, image_corners.len()
            );
            return (None, false);
        }

        if second_max_count > 0 && (max_count as f32) < (second_max_count as f32 * 1.35) {
            println!(
                "[long-screenshot][stitcher] dominant offset ambiguous: max_count={}, second_max_count={}",
                max_count, second_max_count
            );
            return (None, false);
        }

        let (dominant_scroll_index, dominant_origin_position_index, dominant_new_position_index) =
            max_offset;

        (
            Some((
                dominant_scroll_index,
                *dominant_origin_position_index,
                *dominant_new_position_index,
            )),
            false,
        )
    }

    fn row_diff(prev: &RgbaImage, next: &RgbaImage, prev_y: u32, next_y: u32) -> f64 {
        let width = prev.width().min(next.width());
        if width == 0 {
            return f64::MAX;
        }

        let margin = (width / 20).max(4);
        let start_x = margin.min(width.saturating_sub(1));
        let end_x = width.saturating_sub(margin).max(start_x + 1);
        let sample_step = (((end_x - start_x) / 96).max(1)) as u32;
        let mut total = 0.0f64;
        let mut count = 0usize;

        let mut x = start_x;
        while x < end_x {
            let p1 = prev.get_pixel(x, prev_y).0;
            let p2 = next.get_pixel(x, next_y).0;
            total += ((p1[0] as f64 - p2[0] as f64).abs()
                + (p1[1] as f64 - p2[1] as f64).abs()
                + (p1[2] as f64 - p2[2] as f64).abs())
                / 3.0;
            count += 1;
            x += sample_step;
        }

        if count == 0 {
            f64::MAX
        } else {
            total / count as f64
        }
    }

    fn frames_are_nearly_identical(prev: &RgbaImage, next: &RgbaImage) -> bool {
        if prev.width() != next.width() || prev.height() != next.height() {
            return false;
        }

        let width = prev.width();
        let height = prev.height();
        if width < 16 || height < 16 {
            return false;
        }

        let step_x = (width / 96).max(1);
        let step_y = (height / 64).max(1);
        let mut total = 0.0f64;
        let mut count = 0usize;
        let mut y = 0u32;

        while y < height {
            let mut x = 0u32;
            while x < width {
                let p1 = prev.get_pixel(x, y).0;
                let p2 = next.get_pixel(x, y).0;
                total += ((p1[0] as f64 - p2[0] as f64).abs()
                    + (p1[1] as f64 - p2[1] as f64).abs()
                    + (p1[2] as f64 - p2[2] as f64).abs())
                    / 3.0;
                count += 1;
                x += step_x;
            }
            y += step_y;
        }

        count > 0 && (total / count as f64) < 1.25
    }

    fn overlap_score(prev: &RgbaImage, next: &RgbaImage, overlap: u32) -> f64 {
        if overlap < 8 {
            return f64::MAX;
        }

        let sample_rows = overlap.min(64);
        let row_step = (overlap / sample_rows.max(1)).max(1);
        let mut total = 0.0f64;
        let mut count = 0usize;
        let mut i = 0u32;

        while i < overlap {
            let prev_y = prev.height().saturating_sub(overlap) + i;
            let next_y = i;
            total += Self::row_diff(prev, next, prev_y, next_y);
            count += 1;
            i += row_step;
        }

        if count == 0 {
            f64::MAX
        } else {
            total / count as f64
        }
    }

    fn grayscale(pixel: &[u8; 4]) -> f64 {
        pixel[0] as f64 * 0.299 + pixel[1] as f64 * 0.587 + pixel[2] as f64 * 0.114
    }

    fn template_correlation(prev: &RgbaImage, next: &RgbaImage, overlap: u32) -> Option<f64> {
        if overlap < 16 || prev.width() != next.width() {
            return None;
        }

        let width = prev.width();
        let height = prev.height().min(next.height());
        let overlap = overlap.min(height);
        if width < 16 || overlap < 16 {
            return None;
        }

        let margin_x = (width / 18).max(4);
        let start_x = margin_x.min(width.saturating_sub(1));
        let end_x = width.saturating_sub(margin_x).max(start_x + 1);
        let step_x = ((end_x - start_x) / 96).max(1);
        let step_y = (overlap / 72).max(1);

        let mut count = 0.0f64;
        let mut sum_a = 0.0f64;
        let mut sum_b = 0.0f64;
        let mut sum_a2 = 0.0f64;
        let mut sum_b2 = 0.0f64;
        let mut sum_ab = 0.0f64;

        let mut dy = 0u32;
        while dy < overlap {
            let prev_y = prev.height().saturating_sub(overlap) + dy;
            let next_y = dy;
            let mut x = start_x;
            while x < end_x {
                let a = Self::grayscale(&prev.get_pixel(x, prev_y).0);
                let b = Self::grayscale(&next.get_pixel(x, next_y).0);
                count += 1.0;
                sum_a += a;
                sum_b += b;
                sum_a2 += a * a;
                sum_b2 += b * b;
                sum_ab += a * b;
                x += step_x;
            }
            dy += step_y;
        }

        if count < 32.0 {
            return None;
        }

        let numerator = sum_ab - (sum_a * sum_b / count);
        let denom_a = sum_a2 - (sum_a * sum_a / count);
        let denom_b = sum_b2 - (sum_b * sum_b / count);
        let denominator = (denom_a * denom_b).sqrt();
        if denominator <= 1e-6 {
            return None;
        }

        Some((numerator / denominator).clamp(-1.0, 1.0))
    }

    fn overlap_candidate(
        prev: &RgbaImage,
        next: &RgbaImage,
        overlap: u32,
        expected_unique_height: Option<u32>,
    ) -> OverlapCandidate {
        let height = prev.height().min(next.height());
        let unique_height = height.saturating_sub(overlap);
        let row_score = Self::overlap_score(prev, next, overlap);
        let template_corr = Self::template_correlation(prev, next, overlap);
        let template_cost = template_corr
            .map(|corr| (1.0 - corr).max(0.0) * 44.0)
            .unwrap_or(16.0);
        let distance_cost = match expected_unique_height {
            Some(expected) => unique_height.abs_diff(expected) as f64 * 0.018,
            None => {
                let target_unique_height = ((height as f64) * 0.48).round() as u32;
                unique_height.abs_diff(target_unique_height) as f64 * 0.01
            }
        };
        let adjusted_score = row_score * 0.72 + template_cost + distance_cost;

        OverlapCandidate {
            overlap,
            unique_height,
            row_score,
            template_corr,
            adjusted_score,
        }
    }

    fn find_fallback_overlap(
        prev: &RgbaImage,
        next: &RgbaImage,
        min_unique_height: u32,
        max_unique_height: u32,
        expected_unique_height: Option<u32>,
    ) -> Option<(u32, f64)> {
        let height = prev.height().min(next.height());
        if height < 80 || prev.width() != next.width() {
            return None;
        }

        let min_unique_height = min_unique_height.max(8).min(height.saturating_sub(12));
        let max_unique_height = max_unique_height
            .max(min_unique_height)
            .min(height.saturating_sub(8));
        let min_overlap = height.saturating_sub(max_unique_height);
        let max_overlap = height.saturating_sub(min_unique_height);
        let expected_unique_height =
            expected_unique_height.map(|value| value.max(min_unique_height).min(max_unique_height));

        let overlaps = (min_overlap..=max_overlap).step_by(2).collect::<Vec<_>>();
        let mut candidates = overlaps
            .par_iter()
            .map(|overlap| Self::overlap_candidate(prev, next, *overlap, expected_unique_height))
            .collect::<Vec<_>>();

        candidates.sort_by(|a, b| {
            a.adjusted_score
                .partial_cmp(&b.adjusted_score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    if expected_unique_height.is_some() {
                        b.overlap.cmp(&a.overlap)
                    } else {
                        a.overlap.cmp(&b.overlap)
                    }
                })
        });

        let Some(best) = candidates.first().copied() else {
            return None;
        };

        let short_region = height <= 220;
        let first_append = expected_unique_height.is_none();
        let max_score = if short_region {
            22.0
        } else if first_append {
            22.0
        } else if expected_unique_height.is_some() {
            18.0
        } else {
            14.0
        };
        let min_corr = if short_region {
            0.50
        } else if first_append {
            0.55
        } else if expected_unique_height.is_some() {
            0.82
        } else {
            0.88
        };
        let corr_ok = best
            .template_corr
            .map(|corr| corr.is_finite() && corr >= min_corr)
            .unwrap_or(false);
        let row_ok = best.row_score < max_score;
        let short_region_ok = short_region
            && best.row_score < 24.0
            && best.unique_height >= (height as f32 * 0.18).round() as u32
            && best.overlap >= 24;
        let first_append_ok = first_append
            && best.row_score < 24.0
            && best.unique_height >= (height as f32 * 0.08).round() as u32
            && best.unique_height <= (height as f32 * 0.78).round() as u32
            && best.overlap >= (height as f32 * 0.14).round() as u32;

        if best.overlap > 0 && (row_ok || corr_ok || short_region_ok || first_append_ok) {
            println!(
                "[long-screenshot][stitcher] fallback best accepted: unique={}, overlap={}, row_score={:.2}, corr={:?}, adjusted={:.2}, short_region={}, first_append={}",
                best.unique_height,
                best.overlap,
                best.row_score,
                best.template_corr,
                best.adjusted_score,
                short_region,
                first_append
            );
            Some((best.overlap, best.row_score))
        } else {
            println!(
                "[long-screenshot][stitcher] fallback best rejected: unique={}, overlap={}, row_score={:.2}, corr={:?}, adjusted={:.2}, max_score={:.2}, min_corr={:.2}, short_region={}, first_append={}, unique_range={}..={}",
                best.unique_height,
                best.overlap,
                best.row_score,
                best.template_corr,
                best.adjusted_score,
                max_score,
                min_corr,
                short_region,
                first_append,
                min_unique_height,
                max_unique_height
            );
            None
        }
    }

    fn try_fallback_append(
        &mut self,
        image: DynamicImage,
    ) -> (Option<(i32, Option<ScrollImageList>)>, bool) {
        if self.current_direction != ScrollDirection::Vertical {
            self.last_full_image = Some(image);
            return (None, false);
        }

        let previous = match self.last_full_image.as_ref() {
            Some(previous) => previous.to_rgba8(),
            None => {
                self.last_full_image = Some(image);
                return (None, false);
            }
        };
        let current = image.to_rgba8();
        let max_global_unique = ((self.image_height as f32 * 0.82).round() as u32)
            .max(24)
            .min(self.image_height.saturating_sub(12));
        let (min_unique_height, max_unique_height) = match self.last_append_size {
            Some(last_append_size) => {
                let min_unique = ((last_append_size as f32 * 0.45).round() as u32)
                    .max(((self.image_height as f32 * 0.035).round() as u32).max(10));
                let max_unique = ((last_append_size as f32 * 2.2).round() as u32)
                    .saturating_add(8)
                    .min(max_global_unique)
                    .max(min_unique);
                (min_unique, max_unique)
            }
            None => {
                let min_unique = ((self.image_height as f32 * 0.04).round() as u32)
                    .max(12)
                    .min(max_global_unique);
                (min_unique, max_global_unique)
            }
        };

        println!(
            "[long-screenshot][stitcher] fallback search: unique_range={}..={}, last_append={:?}",
            min_unique_height, max_unique_height, self.last_append_size
        );

        let (overlap, score) = match Self::find_fallback_overlap(
            &previous,
            &current,
            min_unique_height,
            max_unique_height,
            self.last_append_size,
        ) {
            Some(result) => result,
            None => {
                println!("[long-screenshot][stitcher] fallback overlap not found");
                if let Some(last_append_size) = self.last_append_size {
                    let unique_height = last_append_size
                        .max(((self.image_height as f32 * 0.12).round() as u32).max(12))
                        .min(max_global_unique)
                        .min(self.image_height.saturating_sub(8));
                    let overlap = self.image_height.saturating_sub(unique_height);
                    let cropped = image.crop_imm(0, overlap, self.image_width, unique_height);
                    self.bottom_image_list.push(ScrollImage {
                        image: cropped,
                        overlay_size: 0,
                    });
                    self.bottom_image_size += unique_height as i32;
                    self.last_append_size = Some(unique_height);
                    self.last_full_image = Some(image);
                    println!(
                        "[long-screenshot][stitcher] fallback estimated append bottom: overlap={}, unique={}, bottom_size={}",
                        overlap, unique_height, self.bottom_image_size
                    );
                    return (
                        Some((self.bottom_image_size, Some(ScrollImageList::Bottom))),
                        false,
                    );
                }
                return (None, false);
            }
        };

        let unique_height = self.image_height.saturating_sub(overlap);
        let min_unique_height = ((self.image_height as f32 * 0.018).round() as u32).max(6);
        if unique_height < min_unique_height {
            println!(
                "[long-screenshot][stitcher] fallback unique area too small: unique={}, overlap={}, score={:.2}",
                unique_height, overlap, score
            );
            return (None, false);
        }

        let cropped = image.crop_imm(0, overlap, self.image_width, unique_height);
        self.bottom_image_list.push(ScrollImage {
            image: cropped,
            overlay_size: 0,
        });
        self.bottom_image_size += unique_height as i32;
        self.last_append_size = Some(unique_height);
        self.last_full_image = Some(image);

        println!(
            "[long-screenshot][stitcher] fallback append bottom: overlap={}, unique={}, score={:.2}, bottom_size={}",
            overlap, unique_height, score, self.bottom_image_size
        );

        (
            Some((self.bottom_image_size, Some(ScrollImageList::Bottom))),
            false,
        )
    }

    pub fn handle_image(
        &mut self,
        image: DynamicImage,
        scroll_image_list: ScrollImageList,
    ) -> (Option<(i32, Option<ScrollImageList>)>, bool) {
        let source_image = image.clone();
        if let Some(previous) = self.last_full_image.as_ref() {
            if Self::frames_are_nearly_identical(&previous.to_rgba8(), &source_image.to_rgba8()) {
                println!("[long-screenshot][stitcher] duplicate frame detected, skip");
                return (None, true);
            }
        }

        let image_width = image.width();
        let image_height = image.height();

        if self.image_width == 0 || self.image_height == 0 {
            self.init_image_size(image_width, image_height);
            println!(
                "[long-screenshot][stitcher] init image size: {}x{}, scale={:.3}, dst={}x{}",
                self.image_width,
                self.image_height,
                self.image_scale,
                self.image_dst_width,
                self.image_dst_height
            );
        } else if image_width != self.image_width || image_height != self.image_height {
            println!(
                "[long-screenshot][stitcher] size mismatch: got={}x{}, expected={}x{}",
                image_width, image_height, self.image_width, self.image_height
            );
            return (None, false);
        }

        let gray_image = self.get_gray_image(&image);
        let image_corners = self.get_corners(&gray_image);
        println!(
            "[long-screenshot][stitcher] frame features: corners={}",
            image_corners.len()
        );

        if image_corners.is_empty() {
            println!("[long-screenshot][stitcher] no corners, skip frame");
            return (None, false);
        }

        let image_descriptors = self.get_descriptors(&gray_image, &image_corners);

        if self.top_image_list.is_empty() && self.bottom_image_list.is_empty() {
            let bottom_image = self.push_image(
                image,
                gray_image,
                image_corners.clone(),
                0,
                ScrollOffset { x: 0, y: 0 },
                ScrollOffset { x: 0, y: 0 },
            );

            let mut new_top_image_ann_index = ScrollIndex::new(self.get_descriptor_size());
            new_top_image_ann_index.descriptors = image_descriptors;
            new_top_image_ann_index.corners = image_corners;
            new_top_image_ann_index
                .descriptors
                .iter()
                .enumerate()
                .for_each(|(i, descriptor)| {
                    new_top_image_ann_index
                        .ann_index
                        .add(descriptor, i)
                        .unwrap();
                });

            new_top_image_ann_index
                .ann_index
                .build(Metric::Euclidean)
                .unwrap();

            self.top_image_ann_index = new_top_image_ann_index;
            self.last_full_image = Some(source_image);
            self.last_append_size = None;

            println!(
                "[long-screenshot][stitcher] first frame accepted: bottom_size={}, top_size={}",
                self.bottom_image_size, self.top_image_size
            );
            return (Some(bottom_image), false);
        }

        let first_index = if scroll_image_list == ScrollImageList::Top {
            &self.top_image_ann_index
        } else {
            &self.bottom_image_ann_index
        };

        let (first_offsets, is_origin) = self.get_offsets(
            first_index,
            &image_descriptors,
            &image_corners,
            scroll_image_list,
        );

        if is_origin {
            println!("[long-screenshot][stitcher] first index says frame is origin/no movement");
            return (None, true);
        }

        let mut offsets = first_offsets;

        if offsets.is_none() && self.try_rollback {
            let second_index = if scroll_image_list == ScrollImageList::Top {
                &self.bottom_image_ann_index
            } else {
                &self.top_image_ann_index
            };

            let second_scroll_image_list = if scroll_image_list == ScrollImageList::Top {
                ScrollImageList::Bottom
            } else {
                ScrollImageList::Top
            };

            let (second_offsets, is_origin) = self.get_offsets(
                second_index,
                &image_descriptors,
                &image_corners,
                second_scroll_image_list,
            );

            if is_origin {
                println!(
                    "[long-screenshot][stitcher] rollback index says frame is origin/no movement"
                );
                return (None, true);
            }

            offsets = second_offsets;
        }

        let (dominant_scroll_index, dominant_origin_position_index, dominant_new_position_index) =
            match offsets {
                Some(offsets) => offsets,
                None => {
                    println!("[long-screenshot][stitcher] no reliable offset found");
                    return self.try_fallback_append(source_image);
                }
            };

        let origin_position = dominant_scroll_index.corners[dominant_origin_position_index];
        let new_position = image_corners[dominant_new_position_index];

        let result = self.push_image(
            image,
            gray_image,
            image_corners,
            dominant_scroll_index.position,
            origin_position,
            new_position,
        );
        if result.1.is_none() {
            return self.try_fallback_append(source_image);
        }
        self.last_full_image = Some(source_image);

        (Some(result), false)
    }

    pub fn export(&mut self) -> Option<DynamicImage> {
        if self.top_image_list.is_empty() && self.bottom_image_list.is_empty() {
            return None;
        }

        let (total_width, total_height) = if self.current_direction == ScrollDirection::Vertical {
            (
                self.image_width as usize,
                (self.top_image_size + self.bottom_image_size) as usize,
            )
        } else {
            (
                (self.top_image_size + self.bottom_image_size) as usize,
                self.image_height as usize,
            )
        };

        const RGBA_CHANNEL_COUNT: usize = 4;
        let mut final_image = vec![0; total_width * total_height * RGBA_CHANNEL_COUNT];

        let mut offset_x = 0i32;
        let mut offset_y = 0i32;

        if self.current_direction == ScrollDirection::Vertical {
            offset_y = self.top_image_size;
        } else {
            offset_x = self.top_image_size;
        }

        for scroll_image in self.bottom_image_list.iter() {
            let img = &scroll_image.image;
            let overlay_size = scroll_image.overlay_size;

            if self.current_direction == ScrollDirection::Vertical {
                overlay_image(
                    &mut final_image,
                    total_width,
                    img,
                    0,
                    (offset_y - overlay_size).max(0) as usize,
                );
                offset_y += img.height() as i32 - overlay_size;
            } else {
                overlay_image(
                    &mut final_image,
                    total_width,
                    img,
                    (offset_x - overlay_size).max(0) as usize,
                    0,
                );
                offset_x += img.width() as i32 - overlay_size;
            }
        }

        if self.current_direction == ScrollDirection::Vertical {
            offset_y = self.top_image_size;
        } else {
            offset_x = self.top_image_size;
        }

        for scroll_image in self.top_image_list.iter() {
            let img = &scroll_image.image;
            let overlay_size = scroll_image.overlay_size;

            if self.current_direction == ScrollDirection::Vertical {
                let actual_height = img.height() as i32 + overlay_size;
                overlay_image(
                    &mut final_image,
                    total_width,
                    img,
                    0,
                    (offset_y - actual_height).max(0) as usize,
                );
                offset_y -= actual_height;
            } else {
                let actual_width = img.width() as i32 + overlay_size;
                overlay_image(
                    &mut final_image,
                    total_width,
                    img,
                    (offset_x - actual_width).max(0) as usize,
                    0,
                );
                offset_x -= actual_width;
            }
        }

        Some(DynamicImage::ImageRgba8(image::RgbaImage::from_raw(
            total_width as u32,
            total_height as u32,
            final_image,
        )?))
    }
}

fn overlay_image(
    final_image: &mut [u8],
    final_width: usize,
    image: &DynamicImage,
    offset_x: usize,
    offset_y: usize,
) {
    let rgba = image.to_rgba8();
    let image_width = rgba.width() as usize;
    let image_height = rgba.height() as usize;
    let raw = rgba.as_raw();

    for y in 0..image_height {
        let dest_start = ((offset_y + y) * final_width + offset_x) * 4;
        let src_start = y * image_width * 4;
        let len = image_width * 4;
        if dest_start + len <= final_image.len() && src_start + len <= raw.len() {
            final_image[dest_start..dest_start + len]
                .copy_from_slice(&raw[src_start..src_start + len]);
        }
    }
}
