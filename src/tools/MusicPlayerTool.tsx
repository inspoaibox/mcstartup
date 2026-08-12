import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { readBinaryFile, readTextFile } from '@tauri-apps/api/fs';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import {
  Clock,
  Disc3,
  ExternalLink,
  FileText,
  FolderOpen,
  Heart,
  Info,
  Library,
  Link,
  ListMusic,
  Maximize2,
  Mic2,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Repeat,
  Search,
  ShieldCheck,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

type AudioSource = 'file' | 'url';
type RepeatMode = 'off' | 'one' | 'all';
type LibraryView =
  | 'all'
  | 'recent'
  | 'favorites'
  | 'albums'
  | 'artists'
  | 'history'
  | 'local'
  | 'remote';
type CollectionFilter = { type: 'artist' | 'album'; value: string } | null;
type RightPanelTab = 'lyrics' | 'queue' | 'info';

interface TrackItem {
  id: string;
  name: string;
  artist: string;
  album: string;
  path: string;
  source: AudioSource;
  url: string;
  addedAt: number;
  cueSheetPath?: string;
  cueTrackNumber?: number;
  cueStart?: number;
  cueEnd?: number;
}

interface CueParsedSheet {
  albumTitle: string;
  albumPerformer: string;
  tracks: CueParsedTrack[];
}

interface MediaOpenPayload {
  kind: 'video' | 'audio';
  paths: string[];
  createdAt: string;
}

interface MediaAssociationStatus {
  registered: boolean;
  kind: string;
  extensions: string[];
  command?: string | null;
  missing: string[];
  canSetDefaultDirectly: boolean;
  message: string;
}

interface FfmpegStatus {
  installed: boolean;
  version?: string | null;
  path?: string | null;
}

interface MusicMediaContext {
  cuePaths: string[];
  coverPath?: string | null;
}

interface NativeAudioEngine {
  id: string;
  label: string;
  family: string;
  strict: boolean;
  extensions: string[];
  backend: string;
}

interface NativeAudioPlayResult {
  path: string;
  duration?: number | null;
  engine: NativeAudioEngine;
  message: string;
}

interface NativeAudioStatus {
  active: boolean;
  path?: string | null;
  duration?: number | null;
  position: number;
  paused: boolean;
  ended: boolean;
  volume: number;
  speed: number;
  engine?: NativeAudioEngine | null;
}

interface LyricLine {
  time: number;
  text: string;
}

interface CueParsedTrack {
  number: number;
  title: string;
  performer: string;
  file: string;
  start: number;
  end?: number;
}

interface AudioEngineProfile {
  id: string;
  label: string;
  shortName: string;
  family: string;
  description: string;
  extensions: string[];
  playable: boolean;
  backend: 'symphonia' | 'ffmpeg-pcm';
  badgeClass: string;
}

const AUDIO_ENGINE_PROFILES: AudioEngineProfile[] = [
  {
    id: 'symphonia-mpeg',
    label: 'Symphonia MPEG 音频核心',
    shortName: 'MP3 Core',
    family: 'MPEG Layer III',
    description: 'MP3 使用内置 MPEG 解码核心播放，不调用系统播放器。',
    extensions: ['mp3'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
  },
  {
    id: 'ffmpeg-mpeg-audio',
    label: 'FFmpeg MPEG 音频解码核心',
    shortName: 'MPEG Core',
    family: 'MPEG Layer I/II',
    description: 'MP1、MP2 使用 FFmpeg 解码为 PCM 后由内置播放器输出。',
    extensions: ['mp1', 'mp2'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
  },
  {
    id: 'symphonia-flac',
    label: 'Symphonia FLAC 无损核心',
    shortName: 'FLAC Core',
    family: 'FLAC Lossless',
    description: 'FLAC 使用内置无损解码核心播放。',
    extensions: ['flac'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-200',
  },
  {
    id: 'symphonia-pcm',
    label: 'Symphonia PCM/WAV 核心',
    shortName: 'PCM Core',
    family: 'PCM/WAV',
    description: 'WAV/WAVE/PCM 使用内置 PCM 核心播放。',
    extensions: ['wav', 'wave'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/25 dark:text-cyan-200',
  },
  {
    id: 'symphonia-aac',
    label: 'Symphonia AAC/MP4 音频核心',
    shortName: 'AAC Core',
    family: 'AAC/ISO-MP4',
    description: 'AAC、M4A、M4B 使用内置 ISO-MP4/AAC 核心播放。',
    extensions: ['m4a', 'mp4a', 'aac', 'adts', 'm4b'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
  },
  {
    id: 'symphonia-alac',
    label: 'Symphonia ALAC 无损核心',
    shortName: 'ALAC Core',
    family: 'Apple Lossless',
    description: 'ALAC 使用内置 Apple Lossless 核心播放。',
    extensions: ['alac'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-teal-50 text-teal-700 dark:bg-teal-900/25 dark:text-teal-200',
  },
  {
    id: 'symphonia-ogg-vorbis',
    label: 'Symphonia Ogg/Vorbis 核心',
    shortName: 'Ogg Core',
    family: 'Ogg/Vorbis',
    description: 'Ogg/Vorbis 使用内置容器和解码核心播放。',
    extensions: ['ogg', 'oga'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-200',
  },
  {
    id: 'ffmpeg-opus',
    label: 'FFmpeg Opus 解码核心',
    shortName: 'Opus Core',
    family: 'Opus',
    description: 'Opus 使用 FFmpeg 解码为 PCM，不调用系统播放器。',
    extensions: ['opus'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-violet-50 text-violet-700 dark:bg-violet-900/25 dark:text-violet-200',
  },
  {
    id: 'ffmpeg-wma',
    label: 'FFmpeg Windows Media Audio 解码核心',
    shortName: 'WMA Core',
    family: 'Windows Media Audio',
    description: 'WMA、ASF 使用 FFmpeg 解码为 PCM，不调用系统播放器。',
    extensions: ['wma', 'asf', 'wm'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-rose-50 text-rose-700 dark:bg-rose-900/25 dark:text-rose-200',
  },
  {
    id: 'ffmpeg-ape',
    label: "FFmpeg Monkey's Audio 解码核心",
    shortName: 'APE Core',
    family: "Monkey's Audio",
    description: 'APE 使用 FFmpeg 无损解码为 PCM，不调用系统播放器。',
    extensions: ['ape'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-green-50 text-green-700 dark:bg-green-900/25 dark:text-green-200',
  },
  {
    id: 'ffmpeg-amr',
    label: 'FFmpeg AMR 语音音频解码核心',
    shortName: 'AMR Core',
    family: 'AMR',
    description: 'AMR、3GA 使用 FFmpeg 语音音频核心解码。',
    extensions: ['amr', '3ga'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-orange-50 text-orange-700 dark:bg-orange-900/25 dark:text-orange-200',
  },
  {
    id: 'ffmpeg-dolby',
    label: 'FFmpeg Dolby AC-3 解码核心',
    shortName: 'AC3 Core',
    family: 'AC-3/E-AC-3',
    description: 'AC3、EAC3 使用 FFmpeg 解码为 PCM。',
    extensions: ['ac3', 'eac3'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-purple-50 text-purple-700 dark:bg-purple-900/25 dark:text-purple-200',
  },
  {
    id: 'ffmpeg-dts',
    label: 'FFmpeg DTS 解码核心',
    shortName: 'DTS Core',
    family: 'DTS',
    description: 'DTS 使用 FFmpeg 解码为 PCM。',
    extensions: ['dts'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-900/25 dark:text-fuchsia-200',
  },
  {
    id: 'ffmpeg-tta',
    label: 'FFmpeg TTA 无损解码核心',
    shortName: 'TTA Core',
    family: 'True Audio',
    description: 'TTA 使用 FFmpeg 无损解码为 PCM。',
    extensions: ['tta'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-lime-50 text-lime-700 dark:bg-lime-900/25 dark:text-lime-200',
  },
  {
    id: 'ffmpeg-tak',
    label: 'FFmpeg TAK 无损解码核心',
    shortName: 'TAK Core',
    family: "Tom's lossless Audio",
    description: 'TAK 使用 FFmpeg 无损解码为 PCM。',
    extensions: ['tak'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-lime-50 text-lime-700 dark:bg-lime-900/25 dark:text-lime-200',
  },
  {
    id: 'ffmpeg-musepack',
    label: 'FFmpeg Musepack 解码核心',
    shortName: 'MPC Core',
    family: 'Musepack',
    description: 'Musepack 使用 FFmpeg 解码为 PCM。',
    extensions: ['mpc', 'mpp'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
  },
  {
    id: 'ffmpeg-realaudio',
    label: 'FFmpeg RealAudio 解码核心',
    shortName: 'RA Core',
    family: 'RealAudio',
    description: 'RealAudio 使用 FFmpeg 解码为 PCM。',
    extensions: ['ra', 'rm'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-pink-50 text-pink-700 dark:bg-pink-900/25 dark:text-pink-200',
  },
  {
    id: 'ffmpeg-sun-au',
    label: 'FFmpeg AU/SND 解码核心',
    shortName: 'AU Core',
    family: 'Sun/NeXT AU',
    description: 'AU、SND 使用 FFmpeg 解码为 PCM。',
    extensions: ['au', 'snd'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/25 dark:text-yellow-200',
  },
  {
    id: 'symphonia-aiff',
    label: 'Symphonia AIFF/PCM 核心',
    shortName: 'AIFF Core',
    family: 'AIFF',
    description: 'AIFF/AIF 使用内置 PCM 核心播放。',
    extensions: ['aiff', 'aif', 'aifc'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-sky-50 text-sky-700 dark:bg-sky-900/25 dark:text-sky-200',
  },
  {
    id: 'ffmpeg-caf',
    label: 'FFmpeg Core Audio Format 解码核心',
    shortName: 'CAF Core',
    family: 'Core Audio Format',
    description: 'CAF 使用 FFmpeg 解码为 PCM。',
    extensions: ['caf'],
    playable: true,
    backend: 'ffmpeg-pcm',
    badgeClass: 'bg-sky-50 text-sky-700 dark:bg-sky-900/25 dark:text-sky-200',
  },
  {
    id: 'symphonia-matroska',
    label: 'Symphonia Matroska 音频核心',
    shortName: 'MKA Core',
    family: 'Matroska Audio',
    description: 'MKA 使用内置 Matroska 音频核心播放。',
    extensions: ['mka'],
    playable: true,
    backend: 'symphonia',
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
];

const AUDIO_EXTENSIONS = AUDIO_ENGINE_PROFILES.flatMap((profile) => profile.extensions);

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const LIBRARY_STORAGE_KEY = 'mcstartup.music-player.library.v1';
const FAVORITES_STORAGE_KEY = 'mcstartup.music-player.favorites.v1';
const HISTORY_STORAGE_KEY = 'mcstartup.music-player.history.v1';
const LYRICS_STORAGE_KEY = 'mcstartup.music-player.lyrics.v1';
const COVERS_STORAGE_KEY = 'mcstartup.music-player.covers.v1';
const CUE_EXTENSION = 'cue';

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function dirname(path: string) {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index >= 0 ? path.slice(0, index) : '';
}

function joinSiblingPath(basePath: string, fileName: string) {
  if (/^[a-z]:[\\/]/i.test(fileName) || fileName.startsWith('\\\\') || fileName.startsWith('/')) {
    return fileName;
  }
  const base = dirname(basePath);
  return base ? `${base}\\${fileName}` : fileName;
}

function parentFolder(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

function stripExtension(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function extension(path: string) {
  return (path.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1] || '').toLowerCase();
}

function audioEngineForExtension(ext: string) {
  return AUDIO_ENGINE_PROFILES.find((profile) => profile.extensions.includes(ext)) || null;
}

function isAudioPath(path: string) {
  return !!audioEngineForExtension(extension(path));
}

function isRemoteUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function audioEngineForTrack(track: Pick<TrackItem, 'path' | 'source'>) {
  if (track.source !== 'file') return null;
  return audioEngineForExtension(extension(track.path));
}

function trackUrl(path: string, source: AudioSource) {
  return source === 'url' ? path : convertFileSrc(path);
}

function parseTrackName(path: string, source: AudioSource) {
  const raw = source === 'url' ? path.replace(/^https?:\/\//i, '') : stripExtension(basename(path));
  const parts = raw.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim() || '未知艺术家',
      name: parts.slice(1).join(' - ').trim() || raw,
    };
  }
  return {
    artist: source === 'url' ? '网络音频' : '未知艺术家',
    name: raw || '未命名音频',
  };
}

function makeTrack(path: string, source: AudioSource): TrackItem {
  const trimmed = path.trim();
  const parsed = parseTrackName(trimmed, source);
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: parsed.name,
    artist: parsed.artist,
    album: source === 'url' ? '网络来源' : parentFolder(trimmed) || '本地音乐',
    path: trimmed,
    source,
    url: trackUrl(trimmed, source),
    addedAt: Date.now(),
  };
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatAddedAt(timestamp: number) {
  return new Date(timestamp).toLocaleDateString([], { month: '2-digit', day: '2-digit' });
}

function nextRepeatMode(current: RepeatMode): RepeatMode {
  if (current === 'off') return 'all';
  if (current === 'all') return 'one';
  return 'off';
}

function repeatText(mode: RepeatMode) {
  if (mode === 'one') return '单曲循环';
  if (mode === 'all') return '列表循环';
  return '顺序播放';
}

function trackKey(track: TrackItem) {
  if (track.cueSheetPath && track.cueTrackNumber) {
    return `${track.source}:cue:${track.cueSheetPath}:${track.cueTrackNumber}`;
  }
  return `${track.source}:${track.path}`;
}

function companionLyricsCandidates(path: string) {
  const stem = path.replace(/\.[^./\\]+$/, '');
  return [`${stem}.lrc`, `${stem}.txt`];
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'BUTTON'
  );
}

function loadStringArray(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function loadStringRecord(key: string): Record<string, string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => {
        return typeof entry[0] === 'string' && typeof entry[1] === 'string';
      })
    );
  } catch {
    return {};
  }
}

function coverKeyForTrack(track: Pick<TrackItem, 'album' | 'artist' | 'cueSheetPath'>) {
  if (track.cueSheetPath) return `cue:${track.cueSheetPath}`;
  return `album:${track.artist || '未知艺术家'}:${track.album || '未知专辑'}`;
}

function isImagePath(path: string) {
  return /\.(png|jpe?g|webp|bmp)$/i.test(path);
}

function parseLrcTime(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ? Number(match[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
  return minutes * 60 + seconds + fraction;
}

function parseLyrics(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
    if (stamps.length === 0) continue;
    const text = line.replace(/\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/g, '').trim();
    for (const stamp of stamps) {
      const time = parseLrcTime(stamp[1]);
      if (time !== null) {
        lines.push({ time, text: text || '...' });
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function decodeCueText(bytes: Uint8Array) {
  const encodings = ['utf-8', 'gb18030', 'big5', 'shift_jis'];
  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding, { fatal: false }).decode(bytes);
      if (text.includes('FILE') || text.includes('TRACK') || text.includes('INDEX')) return text;
    } catch {
      // Some runtimes may not expose every legacy decoder.
    }
  }
  return new TextDecoder().decode(bytes);
}

function parseCueTime(value: string) {
  const match = value.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 75;
}

function cueValue(line: string, keyword: string) {
  const match = line.match(new RegExp(`^${keyword}\\s+(?:"([^"]*)"|(.+))$`, 'i'));
  return (match?.[1] || match?.[2] || '').trim();
}

function parseCueSheet(raw: string, cuePath: string): CueParsedSheet {
  const lines = raw
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let albumTitle = stripExtension(basename(cuePath));
  let albumPerformer = '未知艺术家';
  let currentFile = '';
  const tracks: Array<CueParsedTrack & { end?: number }> = [];
  let current: CueParsedTrack | null = null;

  for (const line of lines) {
    const fileMatch = line.match(/^FILE\s+"?(.+?)"?\s+\w+$/i);
    if (fileMatch) {
      currentFile = joinSiblingPath(cuePath, fileMatch[1].trim());
      continue;
    }

    const trackMatch = line.match(/^TRACK\s+(\d+)\s+\w+/i);
    if (trackMatch) {
      current = {
        number: Number(trackMatch[1]),
        title: '',
        performer: '',
        file: currentFile,
        start: 0,
      };
      tracks.push(current);
      continue;
    }

    if (/^TITLE\s+/i.test(line)) {
      const value = cueValue(line, 'TITLE');
      if (current) current.title = value;
      else albumTitle = value || albumTitle;
      continue;
    }

    if (/^PERFORMER\s+/i.test(line)) {
      const value = cueValue(line, 'PERFORMER');
      if (current) current.performer = value;
      else albumPerformer = value || albumPerformer;
      continue;
    }

    const indexMatch = line.match(/^INDEX\s+01\s+(\d+:\d{2}:\d{2})$/i);
    if (indexMatch && current) {
      current.start = parseCueTime(indexMatch[1]) || 0;
    }
  }

  const parsedTracks = tracks
    .filter((track) => track.file && isAudioPath(track.file))
    .map((track, index, items) => ({
      ...track,
      title: track.title || `Track ${String(track.number).padStart(2, '0')}`,
      performer: track.performer || albumPerformer,
      end: items[index + 1]?.file === track.file ? items[index + 1].start : undefined,
    }))
    .map((track) => ({
      ...track,
      title: `${String(track.number).padStart(2, '0')}. ${track.title}`,
      performer: track.performer || albumPerformer,
      file: track.file,
      end: track.end && track.end > track.start ? track.end : undefined,
    }));

  return {
    albumTitle,
    albumPerformer,
    tracks: parsedTracks,
  };
}

function loadStoredTracks(): TrackItem[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(LIBRARY_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is Partial<TrackItem> => {
        return (
          item &&
          typeof item === 'object' &&
          typeof item.path === 'string' &&
          (item.source === 'file' || item.source === 'url')
        );
      })
      .map((item) => {
        const fallback = makeTrack(item.path || '', item.source || 'file');
        return {
          id: item.id || fallback.id,
          name: item.name || fallback.name,
          artist: item.artist || fallback.artist,
          album: item.album || fallback.album,
          path: item.path || fallback.path,
          source: item.source || fallback.source,
          url: trackUrl(item.path || fallback.path, item.source || fallback.source),
          addedAt: typeof item.addedAt === 'number' ? item.addedAt : fallback.addedAt,
          cueSheetPath:
            typeof item.cueSheetPath === 'string' && item.cueSheetPath
              ? item.cueSheetPath
              : undefined,
          cueTrackNumber: typeof item.cueTrackNumber === 'number' ? item.cueTrackNumber : undefined,
          cueStart: typeof item.cueStart === 'number' ? item.cueStart : undefined,
          cueEnd: typeof item.cueEnd === 'number' ? item.cueEnd : undefined,
        };
      });
  } catch {
    return [];
  }
}

function pushUniqueFront(values: string[], value: string, limit = 100) {
  return [value, ...values.filter((item) => item !== value)].slice(0, limit);
}

function groupTracks(
  tracks: TrackItem[],
  key: 'artist' | 'album'
): Array<{ name: string; subtitle: string; tracks: TrackItem[] }> {
  const groups = new Map<string, TrackItem[]>();
  for (const track of tracks) {
    const name = track[key] || (key === 'artist' ? '未知艺术家' : '未知专辑');
    groups.set(name, [...(groups.get(name) || []), track]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({
      name,
      subtitle:
        key === 'album'
          ? [...new Set(items.map((item) => item.artist))].slice(0, 2).join(' / ') || '未知艺术家'
          : `${new Set(items.map((item) => item.album)).size} 张专辑`,
      tracks: items,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export default function MusicPlayerTool() {
  const ready = useToolTheme();
  const autoLyricCheckedRef = useRef(new Set<string>());
  const nativeEndedRef = useRef(false);
  const lastAutoPlayIdRef = useRef('');
  const [tracks, setTracks] = useState<TrackItem[]>(() => loadStoredTracks());
  const [activeId, setActiveId] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [autoNext, setAutoNext] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>('all');
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('lyrics');
  const [focusMode, setFocusMode] = useState(false);
  const [nativeSessionPath, setNativeSessionPath] = useState('');
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>(() =>
    loadStringArray(FAVORITES_STORAGE_KEY)
  );
  const [playHistoryKeys, setPlayHistoryKeys] = useState<string[]>(() =>
    loadStringArray(HISTORY_STORAGE_KEY)
  );
  const [lyricsByTrack, setLyricsByTrack] = useState<Record<string, string>>(() =>
    loadStringRecord(LYRICS_STORAGE_KEY)
  );
  const [coverByAlbum, setCoverByAlbum] = useState<Record<string, string>>(() =>
    loadStringRecord(COVERS_STORAGE_KEY)
  );
  const [search, setSearch] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [associationStatus, setAssociationStatus] = useState<MediaAssociationStatus | null>(null);
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus | null>(null);
  const [associationBusy, setAssociationBusy] = useState(false);

  const favoriteSet = useMemo(() => new Set(favoriteKeys), [favoriteKeys]);
  const activeTrack = useMemo(
    () => tracks.find((track) => track.id === activeId) || null,
    [activeId, tracks]
  );
  const activeIndex = useMemo(
    () => tracks.findIndex((track) => track.id === activeId),
    [activeId, tracks]
  );
  const artistCount = useMemo(
    () => new Set(tracks.map((track) => track.artist).filter(Boolean)).size,
    [tracks]
  );
  const albumCount = useMemo(
    () => new Set(tracks.map((track) => track.album).filter(Boolean)).size,
    [tracks]
  );
  const favoriteCount = useMemo(
    () => tracks.filter((track) => favoriteSet.has(trackKey(track))).length,
    [favoriteSet, tracks]
  );
  const historyTracks = useMemo(() => {
    const byKey = new Map(tracks.map((track) => [trackKey(track), track]));
    return playHistoryKeys
      .map((key) => byKey.get(key))
      .filter((track): track is TrackItem => !!track);
  }, [playHistoryKeys, tracks]);
  const albumGroups = useMemo(() => groupTracks(tracks, 'album'), [tracks]);
  const artistGroups = useMemo(() => groupTracks(tracks, 'artist'), [tracks]);
  const trackStart = activeTrack?.cueStart || 0;
  const trackEnd = activeTrack?.cueEnd;
  const displayCurrentTime = Math.max(0, currentTime - trackStart);
  const displayDuration =
    trackEnd && trackEnd > trackStart ? trackEnd - trackStart : Math.max(0, duration - trackStart);
  const progress =
    displayDuration > 0 ? Math.min(100, (displayCurrentTime / displayDuration) * 100) : 0;
  const activeTrackKey = activeTrack ? trackKey(activeTrack) : '';
  const activeEngine = activeTrack ? audioEngineForTrack(activeTrack) : null;
  const activeCoverPath = activeTrack
    ? coverByAlbum[coverKeyForTrack(activeTrack)] || coverByAlbum[activeTrack.album] || ''
    : '';
  const activeLyricsRaw = activeTrackKey ? lyricsByTrack[activeTrackKey] || '' : '';
  const activeLyricLines = useMemo(() => parseLyrics(activeLyricsRaw), [activeLyricsRaw]);
  const activeLyricIndex = useMemo(() => {
    if (activeLyricLines.length === 0) return -1;
    let index = -1;
    for (let i = 0; i < activeLyricLines.length; i += 1) {
      if (activeLyricLines[i].time <= displayCurrentTime + 0.2) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  }, [activeLyricLines, displayCurrentTime]);
  const activeLyricText = useMemo(() => {
    if (!activeTrackKey) return '';
    if (activeLyricLines.length > 0) {
      return activeLyricLines[Math.max(0, activeLyricIndex)]?.text || '';
    }
    return (
      activeLyricsRaw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || ''
    );
  }, [activeLyricIndex, activeLyricLines, activeLyricsRaw, activeTrackKey]);
  const focusLyricLines = useMemo(() => {
    if (activeLyricLines.length > 0) {
      const center = Math.max(0, activeLyricIndex);
      const start = Math.max(0, center - 2);
      return activeLyricLines.slice(start, center + 5).map((line, offset) => ({
        key: `${line.time}-${start + offset}`,
        text: line.text,
        time: line.time,
        active: start + offset === center,
      }));
    }
    return activeLyricsRaw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 7)
      .map((line, index) => ({
        key: `${line}-${index}`,
        text: line,
        time: null,
        active: index === 0,
      }));
  }, [activeLyricIndex, activeLyricLines, activeLyricsRaw]);
  const visibleTracks = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const sourceTracks = libraryView === 'history' ? historyTracks : tracks;
    const filtered = sourceTracks.filter((track) => {
      if (collectionFilter?.type === 'artist' && track.artist !== collectionFilter.value)
        return false;
      if (collectionFilter?.type === 'album' && track.album !== collectionFilter.value)
        return false;
      if (libraryView === 'favorites' && !favoriteSet.has(trackKey(track))) return false;
      if (libraryView === 'local' && track.source !== 'file') return false;
      if (libraryView === 'remote' && track.source !== 'url') return false;
      if (!keyword) return true;
      return `${track.name} ${track.artist} ${track.album} ${track.path}`
        .toLowerCase()
        .includes(keyword);
    });
    if (libraryView === 'recent') {
      return [...filtered].sort((a, b) => b.addedAt - a.addedAt);
    }
    return filtered;
  }, [collectionFilter, favoriteSet, historyTracks, libraryView, search, tracks]);

  const queueTracks = useMemo(() => {
    if (activeIndex < 0) return tracks;
    return [...tracks.slice(activeIndex + 1), ...tracks.slice(0, activeIndex)];
  }, [activeIndex, tracks]);

  const libraryItems = useMemo(
    () => [
      { id: 'all' as const, label: '全部音乐', icon: Library, count: tracks.length },
      { id: 'recent' as const, label: '最近添加', icon: Clock, count: tracks.length },
      { id: 'favorites' as const, label: '我喜欢', icon: Heart, count: favoriteCount },
      { id: 'albums' as const, label: '专辑', icon: Disc3, count: albumGroups.length },
      { id: 'artists' as const, label: '艺术家', icon: Music2, count: artistGroups.length },
      { id: 'history' as const, label: '播放历史', icon: ListMusic, count: historyTracks.length },
      {
        id: 'local' as const,
        label: '本地文件',
        icon: FolderOpen,
        count: tracks.filter((track) => track.source === 'file').length,
      },
      {
        id: 'remote' as const,
        label: '网络音频',
        icon: Radio,
        count: tracks.filter((track) => track.source === 'url').length,
      },
    ],
    [albumGroups.length, artistGroups.length, favoriteCount, historyTracks.length, tracks]
  );

  const viewTitle = useMemo(() => {
    if (collectionFilter) {
      return collectionFilter.type === 'album'
        ? `专辑：${collectionFilter.value}`
        : `艺术家：${collectionFilter.value}`;
    }
    return libraryItems.find((item) => item.id === libraryView)?.label || '全部音乐';
  }, [collectionFilter, libraryItems, libraryView]);

  const addTracks = useCallback(
    (next: TrackItem[], rejectedCount = 0, label = '音频') => {
      if (next.length === 0) {
        setError('没有找到已接入内置核心的音频格式。');
        return;
      }
      setError('');
      setMessage(
        `已加入 ${next.length} 首${label}${rejectedCount ? `，拒绝 ${rejectedCount} 个未接入核心的项目` : ''}`
      );
      setTracks((current) => {
        const known = new Set(current.map((track) => trackKey(track)));
        const unique = next.filter((track) => !known.has(trackKey(track)));
        if (unique.length === 0) return current;
        if (!activeId) setActiveId(unique[0].id);
        return [...current, ...unique];
      });
    },
    [activeId]
  );

  const importCueSheet = useCallback(
    async (cuePath: string, coverPath?: string | null) => {
      try {
        const bytes = await readBinaryFile(cuePath);
        const cueText = decodeCueText(bytes);
        const parsed = parseCueSheet(cueText, cuePath);
        if (parsed.tracks.length === 0) {
          setError('CUE 未解析到可播放分轨，或引用的音频格式未接入核心。');
          return;
        }
        const album = parsed.albumTitle || stripExtension(basename(cuePath));
        if (coverPath && isImagePath(coverPath)) {
          setCoverByAlbum((current) => ({ ...current, [`cue:${cuePath}`]: coverPath }));
        }
        const next = parsed.tracks.map(
          (track): TrackItem => ({
            id: `cue-${Date.now()}-${track.number}-${Math.random().toString(16).slice(2)}`,
            name: track.title,
            artist: track.performer || parsed.albumPerformer,
            album,
            path: track.file,
            source: 'file',
            url: trackUrl(track.file, 'file'),
            addedAt: Date.now(),
            cueSheetPath: cuePath,
            cueTrackNumber: track.number,
            cueStart: track.start,
            cueEnd: track.end,
          })
        );
        addTracks(next, 0, 'CUE 分轨');
      } catch (err) {
        setError(`读取 CUE 失败：${err}`);
      }
    },
    [addTracks]
  );

  const enrichLocalMediaContext = useCallback(
    async (paths: string[]) => {
      for (const path of paths) {
        try {
          const context = await invoke<MusicMediaContext>('music_media_context', {
            request: { path },
          });
          if (context.coverPath && isImagePath(context.coverPath)) {
            const album = parentFolder(path) || '本地音乐';
            setCoverByAlbum((current) => ({
              ...current,
              [`album:${'未知艺术家'}:${album}`]: context.coverPath || '',
              [album]: context.coverPath || '',
            }));
          }
          for (const cuePath of context.cuePaths || []) {
            await importCueSheet(cuePath, context.coverPath);
          }
        } catch {
          // Context enrichment is best effort; direct audio import still works without it.
        }
      }
    },
    [importCueSheet]
  );

  const addPaths = useCallback(
    (paths: string[], source: AudioSource = 'file') => {
      const candidates = paths.map((path) => path.trim()).filter(Boolean);
      const cuePaths =
        source === 'file' ? candidates.filter((path) => extension(path) === CUE_EXTENSION) : [];
      for (const cuePath of cuePaths) {
        void importCueSheet(cuePath);
      }
      const audioCandidates = candidates.filter((path) => extension(path) !== CUE_EXTENSION);
      const accepted = audioCandidates.filter((path) => source === 'file' && isAudioPath(path));
      const next = accepted.map((path) => makeTrack(path, source));
      const rejectedCount = audioCandidates.length - accepted.length;
      if (next.length === 0) {
        if (cuePaths.length > 0) return;
        setError(
          source === 'url'
            ? '网络音频流核心尚未接入，已阻止浏览器/平台兜底播放。'
            : '没有找到已接入内置核心的音频格式。'
        );
        return;
      }
      addTracks(next, rejectedCount);
      if (source === 'file') {
        void enrichLocalMediaContext(accepted);
      }
    },
    [addTracks, enrichLocalMediaContext, importCueSheet]
  );

  const chooseFiles = async () => {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: '音频 / CUE 文件', extensions: [...AUDIO_EXTENSIONS, CUE_EXTENSION] }],
    });
    if (Array.isArray(selected)) addPaths(selected);
    if (typeof selected === 'string') addPaths([selected]);
  };

  const addUrl = () => {
    const value = urlInput.trim();
    if (!value) return;
    if (!isRemoteUrl(value)) {
      setError('请输入 http 或 https 音频地址。');
      return;
    }
    addPaths([value], 'url');
    setUrlInput('');
  };

  const updateActiveLyrics = (raw: string) => {
    if (!activeTrack) {
      setError('请先选择一首歌曲。');
      return;
    }
    const key = trackKey(activeTrack);
    setLyricsByTrack((current) => {
      const next = { ...current };
      if (raw.trim()) {
        next[key] = raw;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const chooseLyricsFile = async () => {
    if (!activeTrack) {
      setError('请先选择一首歌曲。');
      return;
    }
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: '歌词文件', extensions: ['lrc', 'txt'] }],
    });
    if (typeof selected !== 'string') return;
    try {
      const text = await readTextFile(selected);
      updateActiveLyrics(text);
      setRightPanelTab('lyrics');
      setError('');
      setMessage('歌词已导入');
    } catch (err) {
      setError(`读取歌词失败：${err}`);
    }
  };

  const tryLoadCompanionLyrics = useCallback(
    async (track: TrackItem, notify = false) => {
      if (track.source !== 'file') return false;
      const key = trackKey(track);
      if (lyricsByTrack[key]?.trim() || autoLyricCheckedRef.current.has(key)) return false;
      autoLyricCheckedRef.current.add(key);

      for (const candidate of companionLyricsCandidates(track.path)) {
        try {
          const text = await readTextFile(candidate);
          if (!text.trim()) continue;
          setLyricsByTrack((current) => {
            if (current[key]?.trim()) return current;
            return { ...current, [key]: text };
          });
          if (notify && activeTrackKey === key) {
            setError('');
            setMessage(`已自动关联歌词：${basename(candidate)}`);
          }
          return true;
        } catch {
          // Missing sidecar lyrics are expected for most local tracks.
        }
      }
      return false;
    },
    [activeTrackKey, lyricsByTrack]
  );

  const selectTrack = useCallback((id: string) => {
    setActiveId(id);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    nativeEndedRef.current = false;
  }, []);

  const playActive = useCallback(async () => {
    if (!activeTrack) return;
    if (!activeEngine?.playable) {
      setError('当前文件没有已接入的内置音频核心，已阻止平台/浏览器兜底。');
      setIsPlaying(false);
      return;
    }
    try {
      if (nativeSessionPath === activeTrack.path) {
        if ((activeTrack.cueStart || 0) > 0) {
          const cueStart = activeTrack.cueStart || 0;
          await invoke('music_audio_seek', { request: { position: cueStart } });
          setCurrentTime(cueStart);
        }
        await invoke('music_audio_resume');
      } else {
        const result = await invoke<NativeAudioPlayResult>('music_audio_play', {
          request: {
            path: activeTrack.path,
            volume: muted ? 0 : volume,
            speed,
            startPaused: false,
          },
        });
        setNativeSessionPath(result.path);
        setCurrentTime(0);
        setDuration(result.duration || 0);
        setMessage(`${result.engine.family} · ${result.message}`);
        setPlayHistoryKeys((current) => pushUniqueFront(current, trackKey(activeTrack), 200));
        if ((activeTrack.cueStart || 0) > 0) {
          const cueStart = activeTrack.cueStart || 0;
          await invoke('music_audio_seek', { request: { position: cueStart } });
          setCurrentTime(cueStart);
        }
      }
      nativeEndedRef.current = false;
      setError('');
      setIsPlaying(true);
    } catch (err) {
      setIsPlaying(false);
      setError(String(err));
    }
  }, [activeEngine, activeTrack, muted, nativeSessionPath, speed, volume]);

  const togglePlay = useCallback(() => {
    if (!activeTrack) return;
    if (!isPlaying) {
      void playActive();
    } else {
      void invoke('music_audio_pause')
        .then(() => setIsPlaying(false))
        .catch((err) => setError(String(err)));
    }
  }, [activeTrack, isPlaying, playActive]);

  const seekTo = useCallback(
    (time: number) => {
      if (!activeTrack || !Number.isFinite(time)) return;
      const offset = activeTrack.cueStart || 0;
      const end = activeTrack.cueEnd || (duration ? offset + duration : undefined);
      const position = Math.max(offset, Math.min(offset + Math.max(0, time), end || offset + time));
      void invoke('music_audio_seek', { request: { position } })
        .then(() => setCurrentTime(position))
        .catch((err) => setError(String(err)));
    },
    [activeTrack, duration]
  );

  const playByOffset = useCallback(
    (offset: number) => {
      if (tracks.length === 0) return;
      if (shuffle && offset > 0 && tracks.length > 1) {
        let nextIndex = Math.floor(Math.random() * tracks.length);
        if (nextIndex === activeIndex) nextIndex = (nextIndex + 1) % tracks.length;
        selectTrack(tracks[nextIndex].id);
        return;
      }
      const current = activeIndex >= 0 ? activeIndex : 0;
      const next = (current + offset + tracks.length) % tracks.length;
      selectTrack(tracks[next].id);
    },
    [activeIndex, selectTrack, shuffle, tracks]
  );

  const toggleFavorite = (track: TrackItem) => {
    const key = trackKey(track);
    setFavoriteKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  };

  const removeTrack = (id: string) => {
    setTracks((current) => {
      const index = current.findIndex((track) => track.id === id);
      const removed = current[index];
      const next = current.filter((track) => track.id !== id);
      if (id === activeId) {
        const replacement = next[index] || next[index - 1] || next[0];
        setActiveId(replacement?.id || '');
        if (!replacement) {
          void invoke('music_audio_stop').catch((err) => setError(String(err)));
          setNativeSessionPath('');
          setIsPlaying(false);
          setCurrentTime(0);
          setDuration(0);
        }
      }
      if (removed) {
        const key = trackKey(removed);
        setPlayHistoryKeys((history) => history.filter((item) => item !== key));
        setFavoriteKeys((favorites) => favorites.filter((item) => item !== key));
        setLyricsByTrack((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
      return next;
    });
  };

  const clearList = () => {
    void invoke('music_audio_stop').catch((err) => setError(String(err)));
    setTracks([]);
    setActiveId('');
    setNativeSessionPath('');
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setFavoriteKeys([]);
    setPlayHistoryKeys([]);
    setLyricsByTrack({});
    setCoverByAlbum({});
    setCollectionFilter(null);
  };

  const refreshAssociationStatus = useCallback(async () => {
    try {
      const status = await invoke<MediaAssociationStatus>('media_file_association_status', {
        request: { kind: 'audio' },
      });
      setAssociationStatus(status);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const registerAudioAssociation = async () => {
    setAssociationBusy(true);
    setError('');
    try {
      const status = await invoke<MediaAssociationStatus>('media_register_file_associations', {
        request: { kind: 'audio' },
      });
      setAssociationStatus(status);
      setMessage(`${status.message} 如需设为默认播放器，请在 Windows 默认应用中确认。`);
    } catch (err) {
      setError(String(err));
    } finally {
      setAssociationBusy(false);
    }
  };

  const openDefaultAppsSettings = async () => {
    try {
      await invoke('media_open_default_apps_settings');
    } catch (err) {
      setError(String(err));
    }
  };

  const refreshFfmpegStatus = useCallback(async () => {
    try {
      const status = await invoke<FfmpegStatus>('music_audio_ffmpeg_status');
      setFfmpegStatus(status);
    } catch {
      setFfmpegStatus({ installed: false });
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(tracks));
  }, [tracks]);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteKeys));
  }, [favoriteKeys]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(playHistoryKeys));
  }, [playHistoryKeys]);

  useEffect(() => {
    window.localStorage.setItem(LYRICS_STORAGE_KEY, JSON.stringify(lyricsByTrack));
  }, [lyricsByTrack]);

  useEffect(() => {
    window.localStorage.setItem(COVERS_STORAGE_KEY, JSON.stringify(coverByAlbum));
  }, [coverByAlbum]);

  useEffect(() => {
    if (!nativeSessionPath) return;
    void invoke('music_audio_set_volume', { request: { value: muted ? 0 : volume } }).catch((err) =>
      setError(String(err))
    );
    void invoke('music_audio_set_speed', { request: { value: speed } }).catch((err) =>
      setError(String(err))
    );
  }, [muted, nativeSessionPath, speed, volume]);

  useEffect(() => {
    if (!activeTrack) return;
    void tryLoadCompanionLyrics(activeTrack, true);
  }, [activeTrack, tryLoadCompanionLyrics]);

  useEffect(() => {
    void refreshAssociationStatus();
  }, [refreshAssociationStatus]);

  useEffect(() => {
    void refreshFfmpegStatus();
  }, [refreshFfmpegStatus]);

  useEffect(() => {
    const takePending = async () => {
      try {
        const payload = await invoke<MediaOpenPayload | null>('media_take_pending_open', {
          request: { kind: 'audio' },
        });
        if (!payload?.paths?.length) return;
        addPaths(payload.paths, 'file');
        setMessage(`已从系统打开 ${payload.paths.length} 首音频`);
      } catch (err) {
        setError(String(err));
      }
    };
    void takePending();
    const timer = window.setInterval(() => void takePending(), 800);
    return () => window.clearInterval(timer);
  }, [addPaths]);

  useEffect(() => {
    const setup = async () => {
      const unlisten = await listen<string[]>('tauri://file-drop', (event) => {
        addPaths(event.payload || []);
      });
      return unlisten;
    };
    let cleanup: (() => void) | undefined;
    void setup().then((fn) => {
      cleanup = fn;
    });
    const prevent = (event: DragEvent) => event.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      cleanup?.();
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, [addPaths]);

  useEffect(() => {
    if (!activeId) {
      lastAutoPlayIdRef.current = '';
      return;
    }
    if (lastAutoPlayIdRef.current === activeId) return;
    lastAutoPlayIdRef.current = activeId;
    const timer = window.setTimeout(() => {
      void playActive();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeId, playActive]);

  useEffect(() => {
    if (!nativeSessionPath) return;
    const timer = window.setInterval(() => {
      void invoke<NativeAudioStatus>('music_audio_status')
        .then((status) => {
          if (!status.active || status.path !== nativeSessionPath) return;
          setCurrentTime(status.position);
          if (status.duration) setDuration(status.duration);
          setIsPlaying(!status.paused && !status.ended);

          if (
            activeTrack?.cueEnd &&
            status.position >= activeTrack.cueEnd - 0.05 &&
            !nativeEndedRef.current
          ) {
            nativeEndedRef.current = true;
            setIsPlaying(false);
            if (repeatMode === 'one') {
              void invoke('music_audio_seek', { request: { position: activeTrack.cueStart || 0 } })
                .then(() => playActive())
                .catch((err) => setError(String(err)));
              return;
            }
            if ((autoNext || repeatMode === 'all') && tracks.length > 1) {
              playByOffset(1);
              return;
            }
            void invoke('music_audio_pause').catch((err) => setError(String(err)));
            return;
          }

          if (!status.ended) {
            nativeEndedRef.current = false;
            return;
          }
          if (nativeEndedRef.current) return;
          nativeEndedRef.current = true;
          setIsPlaying(false);

          if (repeatMode === 'one') {
            void invoke('music_audio_seek', { request: { position: activeTrack?.cueStart || 0 } })
              .then(() => playActive())
              .catch((err) => setError(String(err)));
            return;
          }
          if ((autoNext || repeatMode === 'all') && tracks.length > 1) {
            playByOffset(1);
          }
        })
        .catch((err) => setError(String(err)));
    }, 300);
    return () => window.clearInterval(timer);
  }, [
    activeTrack,
    autoNext,
    nativeSessionPath,
    playActive,
    playByOffset,
    repeatMode,
    tracks.length,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === 'Escape' && focusMode) {
        setFocusMode(false);
        return;
      }
      if (!activeTrack) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      }
      if (event.key === 'ArrowLeft') {
        seekTo(displayCurrentTime - 5);
      }
      if (event.key === 'ArrowRight') {
        seekTo(Math.min(displayDuration || displayCurrentTime + 5, displayCurrentTime + 5));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTrack, displayCurrentTime, displayDuration, focusMode, seekTo, togglePlay]);

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🎵"
        title="音乐播放器"
        subtitle="音乐库、播放队列、歌词、收藏和内置音频核心"
        actions={
          <>
            <ToolbarButton onClick={() => void chooseFiles()}>
              <FolderOpen size={14} />
              导入音乐
            </ToolbarButton>
            <ToolbarButton onClick={clearList} disabled={tracks.length === 0} danger>
              <Trash2 size={14} />
              清空
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[224px_minmax(0,1fr)_360px] overflow-hidden border-t border-gray-200 dark:border-gray-800">
        <aside className="flex min-h-0 flex-col border-r border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950">
            <div className="flex h-11 w-11 items-center justify-center rounded bg-blue-600 text-white">
              <Music2 size={22} />
            </div>
            <div className="min-w-0">
              <div className="font-semibold">本地音乐库</div>
              <div className="text-xs text-gray-500">{tracks.length} 首歌曲</div>
            </div>
          </div>

          <div className="mt-4 space-y-1">
            {libraryItems.map((item) => {
              const Icon = item.icon;
              const active = libraryView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setLibraryView(item.id);
                    setCollectionFilter(null);
                  }}
                  className={`flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm ${
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                      : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon size={16} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {item.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-gray-200 p-2 dark:border-gray-800">
              <div className="text-gray-500">艺术家</div>
              <div className="mt-1 text-lg font-semibold">{artistCount}</div>
            </div>
            <div className="rounded border border-gray-200 p-2 dark:border-gray-800">
              <div className="text-gray-500">专辑</div>
              <div className="mt-1 text-lg font-semibold">{albumCount}</div>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-gray-200 p-2 text-xs dark:border-gray-800">
            <div className="flex items-center gap-1.5 font-semibold">
              <SlidersHorizontal size={14} />
              核心策略
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-gray-500 dark:text-gray-400">
              <div>本地播放：Rodio + Symphonia 内置核心</div>
              <div>
                扩展核心：
                {ffmpegStatus?.installed
                  ? `内置 FFmpeg full build ${ffmpegStatus.version || ''}`.trim()
                  : '内置 FFmpeg full build 未就绪'}
              </div>
              {ffmpegStatus?.path && <div className="truncate">核心路径：{ffmpegStatus.path}</div>}
              <div>未接入格式：直接拒绝，不走平台兜底</div>
              <div>已接入：{AUDIO_EXTENSIONS.map((item) => `.${item}`).join('、')}</div>
            </div>
          </div>

          <div className="mt-auto rounded-md border border-gray-200 p-2 text-xs dark:border-gray-800">
            <div className="flex items-center gap-1.5 font-semibold">
              <ShieldCheck size={14} />
              系统打开方式
            </div>
            <div
              className={`mt-2 rounded px-2 py-1.5 text-[11px] ${
                associationStatus?.registered
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                  : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {associationStatus?.message || '检测 Windows 打开方式注册状态'}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => void registerAudioAssociation()}
                disabled={associationBusy}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <RefreshCw size={13} />
                注册
              </button>
              <button
                onClick={() => void openDefaultAppsSettings()}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <ExternalLink size={13} />
                默认
              </button>
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[280px] flex-1 items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 dark:border-gray-700 dark:bg-gray-950">
                <Search size={16} className="text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索歌曲、艺术家、专辑、路径"
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              <button
                onClick={() => void chooseFiles()}
                className="inline-flex h-10 items-center gap-2 rounded bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={16} />
                导入
              </button>
            </div>

            <div className="mt-4 grid grid-cols-[132px_minmax(0,1fr)] gap-5 rounded-md border border-gray-200 bg-gray-950 p-4 text-white dark:border-gray-800">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-white/10 bg-gray-900 text-blue-300 shadow-sm">
                {activeCoverPath ? (
                  <img
                    src={convertFileSrc(activeCoverPath)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : activeTrack ? (
                  <Disc3 size={58} />
                ) : (
                  <Music2 size={52} />
                )}
              </div>
              <div className="min-w-0 self-center">
                <div className="text-xs font-semibold uppercase text-blue-300">
                  {activeTrack ? '正在播放' : '等待播放'}
                </div>
                <div className="mt-1 truncate text-3xl font-bold">
                  {activeTrack?.name || '导入音乐后开始播放'}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-300">
                  <span>{activeTrack?.artist || '支持多格式音频与 CUE 分轨'}</span>
                  {activeTrack && <span>·</span>}
                  {activeTrack && <span>{activeTrack.album}</span>}
                  {activeTrack && <span>·</span>}
                  {activeTrack && (
                    <span>{extension(activeTrack.path).toUpperCase() || 'AUDIO'}</span>
                  )}
                  {activeTrack && <span>·</span>}
                  {activeTrack && <span>{activeEngine?.shortName || '未接入核心'}</span>}
                  {activeTrack?.cueTrackNumber && <span>·</span>}
                  {activeTrack?.cueTrackNumber && <span>CUE #{activeTrack.cueTrackNumber}</span>}
                </div>
                <button
                  onClick={() => setRightPanelTab('lyrics')}
                  disabled={!activeTrack}
                  className="mt-4 block w-full min-w-0 rounded border border-white/10 bg-white/[0.06] px-3 py-2 text-left hover:bg-white/[0.09] disabled:cursor-default disabled:opacity-70"
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase text-blue-200">
                    <Mic2 size={12} />
                    {activeLyricsRaw ? '歌词已关联' : '歌词'}
                  </span>
                  <span
                    className={`mt-1 block truncate text-sm ${
                      activeLyricText ? 'text-white' : 'text-gray-400'
                    }`}
                  >
                    {activeLyricText || (activeTrack ? '暂无歌词' : '等待播放')}
                  </span>
                </button>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={togglePlay}
                    disabled={!activeTrack || !activeEngine}
                    className="inline-flex h-9 items-center gap-2 rounded bg-white px-3 text-sm font-semibold text-gray-950 hover:bg-gray-100 disabled:opacity-40"
                  >
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                    {isPlaying ? '暂停' : '播放'}
                  </button>
                  {activeTrack && (
                    <button
                      onClick={() => toggleFavorite(activeTrack)}
                      className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-sm ${
                        favoriteSet.has(trackKey(activeTrack))
                          ? 'border-rose-300 bg-rose-500/15 text-rose-200'
                          : 'border-white/15 text-gray-200 hover:bg-white/10'
                      }`}
                    >
                      <Heart size={16} />
                      喜欢
                    </button>
                  )}
                  <button
                    onClick={() => setRightPanelTab('lyrics')}
                    className="inline-flex h-9 items-center gap-2 rounded border border-white/15 px-3 text-sm text-gray-200 hover:bg-white/10"
                  >
                    <Mic2 size={16} />
                    歌词
                  </button>
                  <button
                    onClick={() => setFocusMode(true)}
                    disabled={!activeTrack || !activeEngine}
                    className="inline-flex h-9 items-center gap-2 rounded border border-white/15 px-3 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-40"
                  >
                    <Maximize2 size={16} />
                    沉浸
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex h-11 items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 dark:border-gray-800 dark:bg-gray-900/70">
            <div className="min-w-0 flex-1 truncate text-sm font-semibold">{viewTitle}</div>
            {collectionFilter && (
              <button
                onClick={() => setCollectionFilter(null)}
                className="inline-flex h-7 items-center gap-1.5 rounded border border-gray-200 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
              >
                <X size={12} />
                清除筛选
              </button>
            )}
            <div className="text-xs text-gray-500">
              {libraryView === 'albums'
                ? `${albumGroups.length} 张专辑`
                : libraryView === 'artists'
                  ? `${artistGroups.length} 位艺术家`
                  : `${visibleTracks.length} 首歌曲`}
            </div>
          </div>

          {libraryView === 'albums' || libraryView === 'artists' ? (
            <div className="min-h-0 flex-1 overflow-auto bg-white p-4 dark:bg-gray-950">
              {(libraryView === 'albums' ? albumGroups : artistGroups).length === 0 ? (
                <button
                  onClick={() => void chooseFiles()}
                  className="flex h-full w-full flex-col items-center justify-center gap-3 text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <Disc3 size={44} />
                  <span className="text-sm font-semibold">导入音乐后生成集合</span>
                </button>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                  {(libraryView === 'albums' ? albumGroups : artistGroups).map((group) => {
                    const coverPath =
                      libraryView === 'albums'
                        ? coverByAlbum[coverKeyForTrack(group.tracks[0])] ||
                          coverByAlbum[group.name] ||
                          ''
                        : '';
                    return (
                      <button
                        key={group.name}
                        onClick={() => {
                          setCollectionFilter({
                            type: libraryView === 'albums' ? 'album' : 'artist',
                            value: group.name,
                          });
                          setLibraryView('all');
                        }}
                        className="min-w-0 rounded-md border border-gray-200 bg-white p-3 text-left hover:border-blue-200 hover:bg-blue-50/60 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-900 dark:hover:bg-blue-900/20"
                      >
                        <div className="flex aspect-square items-center justify-center overflow-hidden rounded bg-gray-100 text-blue-600 dark:bg-gray-950 dark:text-blue-300">
                          {coverPath ? (
                            <img
                              src={convertFileSrc(coverPath)}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : libraryView === 'albums' ? (
                            <Disc3 size={42} />
                          ) : (
                            <Music2 size={42} />
                          )}
                        </div>
                        <div className="mt-3 truncate text-sm font-semibold">{group.name}</div>
                        <div className="mt-1 truncate text-xs text-gray-500">{group.subtitle}</div>
                        <div className="mt-2 text-xs text-gray-400">
                          {group.tracks.length} 首歌曲
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid h-10 grid-cols-[52px_minmax(220px,1.4fr)_minmax(140px,0.8fr)_minmax(140px,0.8fr)_90px_72px] items-center border-b border-gray-200 bg-gray-50 px-4 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900/70">
                <div>#</div>
                <div>标题</div>
                <div>艺术家</div>
                <div>专辑</div>
                <div>核心</div>
                <div></div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-white dark:bg-gray-950">
                {visibleTracks.length === 0 ? (
                  <button
                    onClick={() => void chooseFiles()}
                    className="flex h-full w-full flex-col items-center justify-center gap-3 text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900"
                  >
                    <Music2 size={44} />
                    <span className="text-sm font-semibold">
                      {tracks.length === 0 ? '导入音乐建立曲库' : '没有匹配的歌曲'}
                    </span>
                    <span className="text-xs text-gray-500">
                      曲库会自动保存，重新打开播放器也会保留
                    </span>
                  </button>
                ) : (
                  visibleTracks.map((track, index) => {
                    const active = track.id === activeId;
                    const liked = favoriteSet.has(trackKey(track));
                    const engine = audioEngineForTrack(track);
                    return (
                      <div
                        key={track.id}
                        className={`group grid min-h-[58px] grid-cols-[52px_minmax(220px,1.4fr)_minmax(140px,0.8fr)_minmax(140px,0.8fr)_90px_72px] items-center border-b border-gray-100 px-4 text-sm dark:border-gray-900 ${
                          active
                            ? 'bg-blue-50/80 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-900'
                        }`}
                      >
                        <button
                          onClick={() => selectTrack(track.id)}
                          className={`flex h-8 w-8 items-center justify-center rounded ${
                            active
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-500 group-hover:bg-blue-600 group-hover:text-white dark:bg-gray-800'
                          }`}
                          title="播放"
                        >
                          {active && isPlaying ? <Pause size={13} /> : <Play size={13} />}
                        </button>
                        <button onClick={() => selectTrack(track.id)} className="min-w-0 text-left">
                          <span className="block truncate font-semibold">{track.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-gray-400">
                            {index + 1} ·{' '}
                            {track.cueTrackNumber
                              ? `CUE #${track.cueTrackNumber} · ${formatTime(track.cueStart || 0)}`
                              : formatAddedAt(track.addedAt)}
                            {' · '}
                            {track.path}
                          </span>
                        </button>
                        <div className="truncate text-gray-600 dark:text-gray-300">
                          {track.artist}
                        </div>
                        <div className="truncate text-gray-500">{track.album}</div>
                        <div className="min-w-0">
                          <span
                            className={`inline-flex max-w-full truncate rounded px-1.5 py-0.5 text-[11px] ${
                              engine?.badgeClass ||
                              'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                            }`}
                          >
                            {engine?.shortName || '未接入'}
                          </span>
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => toggleFavorite(track)}
                            className={`flex h-7 w-7 items-center justify-center rounded ${
                              liked
                                ? 'text-rose-600'
                                : 'text-gray-300 hover:bg-gray-100 hover:text-rose-600 dark:hover:bg-gray-800'
                            }`}
                            title={liked ? '取消喜欢' : '喜欢'}
                          >
                            <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            onClick={() => removeTrack(track.id)}
                            className="flex h-7 w-7 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                            title="移除"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>

        <aside className="flex min-h-0 flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="grid grid-cols-3 gap-1 rounded bg-gray-100 p-1 text-xs dark:bg-gray-800">
              {[
                { id: 'lyrics' as const, label: '歌词', icon: Mic2 },
                { id: 'queue' as const, label: '队列', icon: ListMusic },
                { id: 'info' as const, label: '信息', icon: Info },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = rightPanelTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setRightPanelTab(tab.id)}
                    className={`flex h-8 items-center justify-center gap-1.5 rounded ${
                      active
                        ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-950 dark:text-blue-300'
                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                  >
                    <Icon size={13} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {rightPanelTab === 'lyrics' && (
            <>
              <div className="min-h-0 flex-1 overflow-auto bg-gray-950 px-5 py-4 text-center text-gray-300">
                {!activeTrack ? (
                  <div className="flex h-full flex-col items-center justify-center text-sm text-gray-500">
                    <Mic2 size={36} />
                    <div className="mt-3 font-semibold">未选择歌曲</div>
                  </div>
                ) : activeLyricLines.length > 0 ? (
                  <div className="space-y-3 py-8">
                    {activeLyricLines.map((line, index) => {
                      const active = index === activeLyricIndex;
                      return (
                        <button
                          key={`${line.time}-${index}`}
                          onClick={() => seekTo(line.time)}
                          className={`block w-full rounded px-3 py-1.5 text-center transition ${
                            active
                              ? 'text-xl font-bold text-white'
                              : index < activeLyricIndex
                                ? 'text-sm text-gray-600'
                                : 'text-sm text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          {line.text}
                        </button>
                      );
                    })}
                  </div>
                ) : activeLyricsRaw.trim() ? (
                  <div className="space-y-2 py-8 text-left text-sm leading-7 text-gray-300">
                    {activeLyricsRaw.split(/\r?\n/).map((line, index) => (
                      <div key={`${line}-${index}`}>{line || ' '}</div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-sm text-gray-500">
                    <FileText size={36} />
                    <div className="mt-3 font-semibold">暂无歌词</div>
                  </div>
                )}
              </div>
              <div className="border-t border-gray-200 p-3 dark:border-gray-800">
                <div className="flex gap-2">
                  <button
                    onClick={() => void chooseLyricsFile()}
                    disabled={!activeTrack || !activeEngine}
                    className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <FolderOpen size={13} />
                    导入 LRC
                  </button>
                  <button
                    onClick={() => setFocusMode(true)}
                    disabled={!activeTrack || !activeEngine}
                    className="inline-flex h-8 items-center justify-center rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <Maximize2 size={13} />
                  </button>
                  <button
                    onClick={() => updateActiveLyrics('')}
                    disabled={!activeTrack || !activeLyricsRaw}
                    className="inline-flex h-8 items-center justify-center rounded border border-gray-200 px-2 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    清空
                  </button>
                </div>
                <textarea
                  value={activeLyricsRaw}
                  onChange={(event) => updateActiveLyrics(event.target.value)}
                  disabled={!activeTrack}
                  placeholder="[00:12.00] 第一行歌词"
                  className="mt-2 h-24 w-full resize-none rounded border border-gray-200 bg-white p-2 text-xs outline-none focus:border-blue-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
                />
              </div>
            </>
          )}

          {rightPanelTab === 'queue' && (
            <>
              <div className="border-b border-gray-200 p-3 dark:border-gray-800">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ListMusic size={16} />
                  播放队列
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {activeTrack ? `当前第 ${activeIndex + 1} 首` : '还没有正在播放的歌曲'}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
                {queueTracks.slice(0, 30).map((track, index) => (
                  <button
                    key={track.id}
                    onClick={() => selectTrack(track.id)}
                    className="mb-1 grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <span className="text-center text-gray-400">{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{track.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                        {track.artist} · {track.album}
                      </span>
                    </span>
                  </button>
                ))}
                {tracks.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-gray-400">
                    <ListMusic size={34} />
                    <div className="mt-3 font-semibold">队列为空</div>
                  </div>
                )}
              </div>
            </>
          )}

          {rightPanelTab === 'info' && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800">
                <div className="mb-2 flex items-center gap-1.5 font-semibold">
                  <SlidersHorizontal size={14} />
                  播放设置
                </div>
                <label className="flex items-center justify-between py-1.5">
                  <span>自动连播</span>
                  <input
                    type="checkbox"
                    checked={autoNext}
                    onChange={(event) => setAutoNext(event.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between py-1.5">
                  <span>倍速</span>
                  <select
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                    className="h-7 rounded border border-gray-200 bg-white px-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                  >
                    {SPEEDS.map((item) => (
                      <option key={item} value={item}>
                        {item}x
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800">
                <div className="mb-2 flex items-center gap-1.5 font-semibold">
                  <Link size={14} />
                  网络音频
                </div>
                <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                  网络流核心尚未接入，当前不会使用浏览器或平台兜底。
                </div>
                <div className="flex gap-2">
                  <input
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addUrl();
                    }}
                    placeholder="https://..."
                    className="h-8 min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                  />
                  <button
                    onClick={addUrl}
                    className="h-8 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    加入
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800">
                <div className="mb-2 flex items-center gap-1.5 font-semibold">
                  <Info size={14} />
                  当前曲目
                </div>
                {activeTrack ? (
                  <div className="space-y-2 text-gray-500 dark:text-gray-400">
                    <div className="truncate">标题：{activeTrack.name}</div>
                    <div className="truncate">艺术家：{activeTrack.artist}</div>
                    <div className="truncate">专辑：{activeTrack.album}</div>
                    <div>时长：{formatTime(displayDuration)}</div>
                    {activeTrack.cueSheetPath && (
                      <div>
                        CUE：第 {activeTrack.cueTrackNumber} 轨 ·{' '}
                        {formatTime(activeTrack.cueStart || 0)}
                      </div>
                    )}
                    <div>核心：{activeEngine?.label || '未接入'}</div>
                    <div>
                      后端：
                      {activeEngine?.backend === 'ffmpeg-pcm'
                        ? 'FFmpeg PCM 解码桥'
                        : activeEngine?.backend === 'symphonia'
                          ? 'Symphonia 原生解码'
                          : '-'}
                    </div>
                    <div>格式族：{activeEngine?.family || '-'}</div>
                    <div>歌词：{activeLyricsRaw ? '已关联' : '未关联'}</div>
                    {activeTrack.cueSheetPath && (
                      <div className="truncate">索引：{activeTrack.cueSheetPath}</div>
                    )}
                    <div className="truncate">路径：{activeTrack.path}</div>
                  </div>
                ) : (
                  <div className="text-gray-500">未选择曲目</div>
                )}
              </div>
            </div>
          )}
        </aside>
      </main>

      <footer className="grid h-[92px] grid-cols-[minmax(220px,1fr)_minmax(360px,1.3fr)_minmax(220px,1fr)] items-center gap-4 border-t border-gray-200 bg-white px-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-100 text-blue-600 dark:border-gray-800 dark:bg-gray-950 dark:text-blue-300">
            <Disc3 size={24} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{activeTrack?.name || '未播放'}</div>
            <div className="mt-0.5 truncate text-xs text-gray-500">
              {activeTrack?.artist || '选择一首音乐开始'}
            </div>
            {activeLyricText && (
              <div className="mt-0.5 truncate text-xs text-blue-600 dark:text-blue-300">
                {activeLyricText}
              </div>
            )}
          </div>
          {activeTrack && (
            <button
              onClick={() => toggleFavorite(activeTrack)}
              className={`flex h-8 w-8 items-center justify-center rounded ${
                favoriteSet.has(trackKey(activeTrack))
                  ? 'text-rose-600'
                  : 'text-gray-400 hover:bg-gray-100 hover:text-rose-600 dark:hover:bg-gray-800'
              }`}
              title="喜欢"
            >
              <Heart
                size={16}
                fill={favoriteSet.has(trackKey(activeTrack)) ? 'currentColor' : 'none'}
              />
            </button>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setShuffle((current) => !current)}
              className={`flex h-8 w-8 items-center justify-center rounded ${
                shuffle
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              title="随机播放"
            >
              <Shuffle size={16} />
            </button>
            <button
              onClick={() => playByOffset(-1)}
              disabled={tracks.length < 2}
              className="flex h-9 w-9 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
              title="上一首"
            >
              <SkipBack size={18} />
            </button>
            <button
              onClick={togglePlay}
              disabled={!activeTrack || !activeEngine}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              title={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? <Pause size={19} /> : <Play size={19} />}
            </button>
            <button
              onClick={() => playByOffset(1)}
              disabled={tracks.length < 2}
              className="flex h-9 w-9 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800"
              title="下一首"
            >
              <SkipForward size={18} />
            </button>
            <button
              onClick={() => setRepeatMode((current) => nextRepeatMode(current))}
              className={`flex h-8 items-center gap-1 rounded px-2 text-xs ${
                repeatMode === 'off'
                  ? 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
              }`}
              title={repeatText(repeatMode)}
            >
              <Repeat size={16} />
              {repeatMode === 'one' ? '单曲' : repeatMode === 'all' ? '循环' : '顺序'}
            </button>
          </div>
          <div className="mt-2 grid grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-2 text-xs text-gray-500">
            <span className="text-right">{formatTime(displayCurrentTime)}</span>
            <input
              type="range"
              min={0}
              max={displayDuration || 0}
              step={0.05}
              value={Math.min(displayCurrentTime, displayDuration || displayCurrentTime)}
              onChange={(event) => seekTo(Number(event.target.value))}
              disabled={!activeTrack || !displayDuration}
              className="h-2 w-full accent-blue-600"
              title={`${progress.toFixed(1)}%`}
            />
            <span>{formatTime(displayDuration)}</span>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          {(message || error) && (
            <div
              className={`hidden max-w-[260px] truncate rounded px-2 py-1 text-xs lg:block ${
                error
                  ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
              }`}
            >
              {error || message}
            </div>
          )}
          <button
            onClick={() => setMuted((current) => !current)}
            className="flex h-8 w-8 items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            title={muted ? '取消静音' : '静音'}
          >
            {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            className="w-28 accent-blue-600"
            title="音量"
          />
        </div>
      </footer>

      {focusMode && activeTrack && (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-950 text-white">
          <div className="flex h-14 items-center gap-3 border-b border-white/10 px-5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-500 text-white">
                <Music2 size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">沉浸播放</div>
                <div className="truncate text-xs text-gray-400">
                  {activeTrack.artist} · {activeTrack.album}
                </div>
              </div>
            </div>
            <button
              onClick={() => setFocusMode(false)}
              className="flex h-9 w-9 items-center justify-center rounded text-gray-300 hover:bg-white/10 hover:text-white"
              title="关闭"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,0.82fr)_minmax(360px,1.25fr)_300px]">
            <section className="flex min-h-0 flex-col justify-center border-r border-white/10 px-8">
              <div className="mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gray-900 shadow-2xl shadow-blue-950/30">
                <div
                  className={`flex h-[74%] w-[74%] items-center justify-center overflow-hidden rounded-full border border-white/10 bg-gray-950 text-blue-300 ${isPlaying && !activeCoverPath ? 'animate-spin' : ''}`}
                  style={{ animationDuration: '16s' }}
                >
                  {activeCoverPath ? (
                    <img
                      src={convertFileSrc(activeCoverPath)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Disc3 size={96} />
                  )}
                </div>
              </div>
              <div className="mt-8 min-w-0 text-center">
                <div className="truncate text-2xl font-bold">{activeTrack.name}</div>
                <div className="mt-2 truncate text-sm text-gray-400">{activeTrack.artist}</div>
                <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-gray-400">
                  <span className="rounded border border-white/10 px-2 py-1">
                    {activeTrack.source === 'url'
                      ? 'URL'
                      : extension(activeTrack.path).toUpperCase() || 'AUDIO'}
                  </span>
                  <span className="rounded border border-white/10 px-2 py-1">
                    {formatTime(displayDuration)}
                  </span>
                  {activeTrack.cueTrackNumber && (
                    <span className="rounded border border-white/10 px-2 py-1">
                      CUE #{activeTrack.cueTrackNumber}
                    </span>
                  )}
                  <span className="rounded border border-white/10 px-2 py-1">
                    {activeEngine?.shortName || '未接入核心'}
                  </span>
                  <span className="rounded border border-white/10 px-2 py-1">
                    {activeLyricsRaw ? '歌词已关联' : '暂无歌词'}
                  </span>
                </div>
              </div>
            </section>

            <section className="flex min-h-0 flex-col justify-center px-10">
              {focusLyricLines.length > 0 ? (
                <div className="space-y-5">
                  {focusLyricLines.map((line) => (
                    <button
                      key={line.key}
                      onClick={() => {
                        if (line.time !== null) seekTo(line.time);
                      }}
                      disabled={line.time === null}
                      className={`block w-full rounded px-4 py-1.5 text-center transition ${
                        line.active
                          ? 'text-4xl font-bold text-white'
                          : 'text-lg text-gray-500 hover:text-gray-300 disabled:hover:text-gray-500'
                      }`}
                    >
                      {line.text}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mx-auto max-w-md text-center text-gray-400">
                  <Mic2 size={42} className="mx-auto" />
                  <div className="mt-4 text-lg font-semibold text-gray-200">暂无歌词</div>
                  <button
                    onClick={() => void chooseLyricsFile()}
                    className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded bg-white px-3 text-sm font-semibold text-gray-950 hover:bg-gray-100"
                  >
                    <FolderOpen size={15} />
                    导入 LRC
                  </button>
                </div>
              )}
            </section>

            <aside className="min-h-0 border-l border-white/10 bg-white/[0.03]">
              <div className="border-b border-white/10 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ListMusic size={16} />
                  播放队列
                </div>
                <div className="mt-1 text-xs text-gray-500">{tracks.length} 首歌曲</div>
              </div>
              <div className="h-[calc(100%-57px)] overflow-auto p-2">
                {[activeTrack, ...queueTracks.slice(0, 24)].map((track, index) => {
                  const active = track.id === activeId;
                  return (
                    <button
                      key={`${track.id}-${index}`}
                      onClick={() => selectTrack(track.id)}
                      className={`mb-1 grid w-full grid-cols-[30px_minmax(0,1fr)] items-center gap-2 rounded px-2 py-2 text-left text-xs ${
                        active
                          ? 'bg-blue-500/15 text-blue-100'
                          : 'text-gray-400 hover:bg-white/10 hover:text-gray-100'
                      }`}
                    >
                      <span className="text-center">{active ? <Pause size={13} /> : index}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{track.name}</span>
                        <span className="mt-0.5 block truncate text-[11px] opacity-70">
                          {track.artist} · {track.album}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>

          <div className="grid h-[104px] grid-cols-[220px_minmax(360px,1fr)_220px] items-center gap-5 border-t border-white/10 px-5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{activeTrack.name}</div>
              <div className="mt-1 truncate text-xs text-gray-400">{activeLyricText}</div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setShuffle((current) => !current)}
                  className={`flex h-8 w-8 items-center justify-center rounded ${
                    shuffle ? 'bg-blue-500 text-white' : 'text-gray-400 hover:bg-white/10'
                  }`}
                  title="随机播放"
                >
                  <Shuffle size={16} />
                </button>
                <button
                  onClick={() => playByOffset(-1)}
                  disabled={tracks.length < 2}
                  className="flex h-10 w-10 items-center justify-center rounded text-gray-300 hover:bg-white/10 disabled:opacity-40"
                  title="上一首"
                >
                  <SkipBack size={19} />
                </button>
                <button
                  onClick={togglePlay}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-950 hover:bg-gray-100"
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <button
                  onClick={() => playByOffset(1)}
                  disabled={tracks.length < 2}
                  className="flex h-10 w-10 items-center justify-center rounded text-gray-300 hover:bg-white/10 disabled:opacity-40"
                  title="下一首"
                >
                  <SkipForward size={19} />
                </button>
                <button
                  onClick={() => setRepeatMode((current) => nextRepeatMode(current))}
                  className={`flex h-8 items-center gap-1 rounded px-2 text-xs ${
                    repeatMode === 'off'
                      ? 'text-gray-400 hover:bg-white/10'
                      : 'bg-blue-500 text-white'
                  }`}
                  title={repeatText(repeatMode)}
                >
                  <Repeat size={16} />
                  {repeatMode === 'one' ? '单曲' : repeatMode === 'all' ? '循环' : '顺序'}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-[46px_minmax(0,1fr)_46px] items-center gap-2 text-xs text-gray-400">
                <span className="text-right">{formatTime(displayCurrentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={displayDuration || 0}
                  step={0.05}
                  value={Math.min(displayCurrentTime, displayDuration || displayCurrentTime)}
                  onChange={(event) => seekTo(Number(event.target.value))}
                  disabled={!displayDuration}
                  className="h-2 w-full accent-blue-500"
                  title={`${progress.toFixed(1)}%`}
                />
                <span>{formatTime(displayDuration)}</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setMuted((current) => !current)}
                className="flex h-8 w-8 items-center justify-center rounded text-gray-300 hover:bg-white/10"
                title={muted ? '取消静音' : '静音'}
              >
                {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="w-28 accent-blue-500"
                title="音量"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
