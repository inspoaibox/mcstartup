import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import { open as openExternal } from '@tauri-apps/api/shell';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import {
  Clock,
  ExternalLink,
  Film,
  FileText,
  FolderOpen,
  Info,
  Link,
  Maximize2,
  Minimize2,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Subtitles,
  SkipBack,
  SkipForward,
  Trash2,
  Waves,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import ToolHeader from './ToolHeader';
import { EmptyState, ToolbarButton } from './systemToolUtils';
import { useToolTheme } from './useToolTheme';

type PlaylistSource = 'file' | 'url';
type RepeatMode = 'off' | 'one' | 'all';
type PlayerEngine = 'native' | 'mpv';
type MpvOpenMode = {
  fullscreen?: boolean;
  mini?: boolean;
  width?: number;
  height?: number;
  alwaysOnTop?: boolean;
};

interface PlaylistItem {
  id: string;
  name: string;
  path: string;
  source: PlaylistSource;
  url: string;
  addedAt: number;
}

interface MpvStatus {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  message: string;
}

interface MpvOpenResult {
  pid: number;
  path: string;
  message: string;
}

interface VideoTrackInfo {
  ordinal: number;
  streamIndex: number;
  codecName?: string | null;
  language?: string | null;
  title?: string | null;
  defaultTrack: boolean;
  forced: boolean;
  channels?: number | null;
  sampleRate?: number | null;
  width?: number | null;
  height?: number | null;
}

interface VideoProbeResult {
  media: string;
  duration?: number | null;
  audioTracks: VideoTrackInfo[];
  subtitleTracks: VideoTrackInfo[];
  videoTracks: VideoTrackInfo[];
  companionSubtitlePaths: string[];
  message: string;
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

const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mkv',
  'avi',
  'flv',
  'wmv',
  'ts',
  'm2ts',
  '3gp',
  'ogv',
  'mpg',
  'mpeg',
  'mpe',
  'm2v',
  'vob',
  'rmvb',
  'divx',
  'f4v',
  'mxf',
  'mts',
];

const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt', 'sub', 'idx', 'sup'];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const MPV_INSTALL_URL = 'https://mpv.io/installation/';
const MPV_PATH_STORAGE_KEY = 'mcstartup.video-player.mpv-path.v1';
const PLAYER_ENGINE_STORAGE_KEY = 'mcstartup.video-player.engine.v1';

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function extension(path: string) {
  return (path.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1] || '').toLowerCase();
}

function isVideoPath(path: string) {
  const ext = extension(path);
  return !ext || VIDEO_EXTENSIONS.includes(ext);
}

function isSubtitlePath(path: string) {
  return SUBTITLE_EXTENSIONS.includes(extension(path));
}

function isRemoteUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function itemUrl(path: string, source: PlaylistSource) {
  return source === 'url' ? path : convertFileSrc(path);
}

function makeItem(path: string, source: PlaylistSource): PlaylistItem {
  const trimmed = path.trim();
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: source === 'url' ? trimmed.replace(/^https?:\/\//i, '') : basename(trimmed),
    path: trimmed,
    source,
    url: itemUrl(trimmed, source),
    addedAt: Date.now(),
  };
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTrackLabel(track: VideoTrackInfo, kind: 'audio' | 'subtitle' | 'video') {
  const parts = [
    kind === 'audio'
      ? `音轨 ${track.ordinal}`
      : kind === 'subtitle'
        ? `字幕 ${track.ordinal}`
        : `视频 ${track.ordinal}`,
    track.language?.toUpperCase(),
    track.title,
    track.codecName?.toUpperCase(),
    track.channels ? `${track.channels}ch` : '',
    track.width && track.height ? `${track.width}x${track.height}` : '',
    track.defaultTrack ? '默认' : '',
    track.forced ? '强制' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function nextRepeatMode(current: RepeatMode): RepeatMode {
  if (current === 'off') return 'all';
  if (current === 'all') return 'one';
  return 'off';
}

function repeatLabel(mode: RepeatMode) {
  if (mode === 'all') return '列表循环';
  if (mode === 'one') return '单个循环';
  return '不循环';
}

function normalizeMiniSize(width: number, height: number) {
  const safeWidth = Number.isFinite(width) ? Math.round(width) : 480;
  const safeHeight = Number.isFinite(height) ? Math.round(height) : 270;
  return {
    width: Math.min(1920, Math.max(240, safeWidth)),
    height: Math.min(1080, Math.max(135, safeHeight)),
  };
}

export default function VideoPlayerTool() {
  const ready = useToolTheme();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [autoNext, setAutoNext] = useState(true);
  const [engine, setEngine] = useState<PlayerEngine>(() => {
    const saved = window.localStorage.getItem(PLAYER_ENGINE_STORAGE_KEY);
    return saved === 'mpv' ? 'mpv' : 'native';
  });
  const [mpvPath, setMpvPath] = useState(
    () => window.localStorage.getItem(MPV_PATH_STORAGE_KEY) || ''
  );
  const [mpvStatus, setMpvStatus] = useState<MpvStatus | null>(null);
  const [checkingMpv, setCheckingMpv] = useState(false);
  const [launchingMpv, setLaunchingMpv] = useState(false);
  const [associationStatus, setAssociationStatus] = useState<MediaAssociationStatus | null>(null);
  const [associationBusy, setAssociationBusy] = useState(false);
  const [probeByPath, setProbeByPath] = useState<Record<string, VideoProbeResult>>({});
  const [probing, setProbing] = useState(false);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number | 'auto'>('auto');
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<number | 'auto' | 'off'>(
    'auto'
  );
  const [externalSubtitles, setExternalSubtitles] = useState<string[]>([]);
  const [miniSize, setMiniSize] = useState({ width: 480, height: 270 });
  const [miniAlwaysOnTop, setMiniAlwaysOnTop] = useState(true);
  const [search, setSearch] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mpvGuideOpen, setMpvGuideOpen] = useState(false);

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) || null,
    [activeId, items]
  );

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      `${item.name} ${item.path} ${item.source}`.toLowerCase().includes(keyword)
    );
  }, [items, search]);

  const activeIndex = useMemo(
    () => items.findIndex((item) => item.id === activeId),
    [activeId, items]
  );

  const activeProbe = activeItem ? probeByPath[activeItem.path] || null : null;
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const addPaths = useCallback(
    (paths: string[], source: PlaylistSource = 'file') => {
      const next = paths
        .map((path) => path.trim())
        .filter(Boolean)
        .filter((path) => source === 'url' || isVideoPath(path))
        .map((path) => makeItem(path, source));
      if (next.length === 0) {
        setError('没有找到可加入播放列表的视频。');
        return;
      }
      setError('');
      setMessage(`已加入 ${next.length} 个视频`);
      setItems((current) => {
        const known = new Set(current.map((item) => `${item.source}:${item.path}`));
        const unique = next.filter((item) => !known.has(`${item.source}:${item.path}`));
        if (unique.length === 0) return current;
        if (!activeId) setActiveId(unique[0].id);
        return [...current, ...unique];
      });
    },
    [activeId]
  );

  const chooseFiles = async () => {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: '视频文件', extensions: VIDEO_EXTENSIONS }],
    });
    if (Array.isArray(selected)) addPaths(selected);
    if (typeof selected === 'string') addPaths([selected]);
  };

  const checkMpv = useCallback(
    async (pathOverride?: string) => {
      setCheckingMpv(true);
      setError('');
      try {
        const status = await invoke<MpvStatus>('video_player_mpv_status', {
          request: { mpvPath: (pathOverride ?? mpvPath) || null },
        });
        setMpvStatus(status);
        if (status.installed) {
          setMessage(status.message);
          setMpvGuideOpen(false);
        } else {
          setError(status.message);
        }
      } catch (err) {
        const text = String(err);
        setMpvStatus({ installed: false, message: text });
        setError(text);
      } finally {
        setCheckingMpv(false);
      }
    },
    [mpvPath]
  );

  const chooseMpvPath = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'MPV 播放器', extensions: ['exe'] }],
    });
    if (typeof selected !== 'string') return;
    setMpvPath(selected);
    window.localStorage.setItem(MPV_PATH_STORAGE_KEY, selected);
    void checkMpv(selected);
  };

  const probeMedia = useCallback(
    async (item?: PlaylistItem | null, silent = false) => {
      const target = item || activeItem;
      if (!target || target.source === 'url') return;
      setProbing(true);
      if (!silent) {
        setError('');
      }
      try {
        const result = await invoke<VideoProbeResult>('video_player_probe_media', {
          request: { media: target.path },
        });
        setProbeByPath((current) => ({ ...current, [target.path]: result }));
        if (result.duration && target.id === activeId) {
          setDuration(result.duration);
        }
        if (result.companionSubtitlePaths.length > 0) {
          setExternalSubtitles((current) => {
            const known = new Set(current.map((path) => path.toLowerCase()));
            const next = result.companionSubtitlePaths.filter(
              (path) => !known.has(path.toLowerCase())
            );
            return next.length > 0 ? [...current, ...next] : current;
          });
        }
        setMessage(result.message);
      } catch (err) {
        if (!silent) setError(String(err));
      } finally {
        setProbing(false);
      }
    },
    [activeId, activeItem]
  );

  const chooseSubtitles = async () => {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: '字幕文件', extensions: SUBTITLE_EXTENSIONS }],
    });
    const paths = Array.isArray(selected)
      ? selected
      : typeof selected === 'string'
        ? [selected]
        : [];
    const subtitles = paths.filter(isSubtitlePath);
    if (subtitles.length === 0) return;
    setExternalSubtitles((current) => {
      const known = new Set(current.map((path) => path.toLowerCase()));
      const next = subtitles.filter((path) => !known.has(path.toLowerCase()));
      return next.length > 0 ? [...current, ...next] : current;
    });
    setSelectedSubtitleTrack('auto');
    setMessage(`已加入 ${subtitles.length} 个外挂字幕`);
  };

  const removeSubtitle = (path: string) => {
    setExternalSubtitles((current) => current.filter((item) => item !== path));
  };

  const refreshAssociationStatus = useCallback(async () => {
    try {
      const status = await invoke<MediaAssociationStatus>('media_file_association_status', {
        request: { kind: 'video' },
      });
      setAssociationStatus(status);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const registerVideoAssociation = async () => {
    setAssociationBusy(true);
    setError('');
    try {
      const status = await invoke<MediaAssociationStatus>('media_register_file_associations', {
        request: { kind: 'video' },
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

  const openMpvInstallGuide = useCallback(() => {
    setMpvGuideOpen(true);
    setError('');
  }, []);

  const addUrl = () => {
    const value = urlInput.trim();
    if (!value) return;
    if (!isRemoteUrl(value)) {
      setError('请输入 http 或 https 视频地址。');
      return;
    }
    addPaths([value], 'url');
    setUrlInput('');
  };

  const selectItem = (id: string) => {
    setActiveId(id);
    setCurrentTime(0);
    setDuration(0);
    setVideoSize(null);
    setIsPlaying(false);
    setSelectedAudioTrack('auto');
    setSelectedSubtitleTrack('auto');
    setExternalSubtitles([]);
  };

  const playActive = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const openInMpv = useCallback(
    async (item?: PlaylistItem | null, mode: MpvOpenMode = {}) => {
      const target = item || activeItem;
      if (!target) return;
      if (target.id !== activeId) {
        setActiveId(target.id);
        setCurrentTime(0);
        setDuration(0);
        setVideoSize(null);
        setIsPlaying(false);
      }
      setLaunchingMpv(true);
      setError('');
      try {
        const mini = mode.mini
          ? normalizeMiniSize(mode.width ?? miniSize.width, mode.height ?? miniSize.height)
          : null;
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
        const result = await invoke<MpvOpenResult>('video_player_mpv_open', {
          request: {
            mpvPath: mpvPath || null,
            media: target.path,
            volume: muted ? 0 : Math.round(volume * 100),
            speed,
            startPaused: false,
            fullscreen: mode.fullscreen || false,
            audioTrack: selectedAudioTrack === 'auto' ? null : selectedAudioTrack,
            subtitleTrack:
              selectedSubtitleTrack === 'auto'
                ? null
                : selectedSubtitleTrack === 'off'
                  ? 0
                  : selectedSubtitleTrack,
            externalSubtitles,
            alwaysOnTop: mode.alwaysOnTop || false,
            windowWidth: mini?.width ?? null,
            windowHeight: mini?.height ?? null,
          },
        });
        setMpvStatus((current) => ({
          installed: true,
          path: result.path,
          version: current?.version || null,
          message: result.message,
        }));
        setMessage(
          mode.fullscreen
            ? `已用 MPV 显示器全屏打开：${target.name}`
            : mode.mini
              ? `已用 MPV 迷你窗口打开：${target.name}`
              : `已用 MPV 打开：${target.name}`
        );
      } catch (err) {
        setError(String(err));
        setMpvGuideOpen(true);
      } finally {
        setLaunchingMpv(false);
      }
    },
    [
      activeId,
      activeItem,
      externalSubtitles,
      miniSize.height,
      miniSize.width,
      mpvPath,
      muted,
      selectedAudioTrack,
      selectedSubtitleTrack,
      speed,
      volume,
    ]
  );

  const togglePlay = () => {
    if (engine === 'mpv') {
      void openInMpv();
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void playActive();
    } else {
      video.pause();
    }
  };

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(time)) return;
    video.currentTime = Math.max(0, Math.min(time, duration || time));
    setCurrentTime(video.currentTime);
  };

  const moveRelative = (seconds: number) => {
    seekTo((videoRef.current?.currentTime || currentTime) + seconds);
  };

  const playByOffset = (offset: number) => {
    if (items.length === 0) return;
    const current = activeIndex >= 0 ? activeIndex : 0;
    const next = (current + offset + items.length) % items.length;
    if (engine === 'mpv') {
      void openInMpv(items[next]);
      return;
    }
    selectItem(items[next].id);
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const index = current.findIndex((item) => item.id === id);
      const next = current.filter((item) => item.id !== id);
      if (id === activeId) {
        const replacement = next[index] || next[index - 1] || next[0];
        setActiveId(replacement?.id || '');
      }
      return next;
    });
  };

  const clearList = () => {
    setItems([]);
    setActiveId('');
    setCurrentTime(0);
    setDuration(0);
    setVideoSize(null);
    setIsPlaying(false);
  };

  const requestDisplayFullscreen = () => {
    void openInMpv(activeItem, { fullscreen: true });
  };

  const openMiniWindow = () => {
    const size = normalizeMiniSize(miniSize.width, miniSize.height);
    void openInMpv(activeItem, {
      mini: true,
      width: size.width,
      height: size.height,
      alwaysOnTop: miniAlwaysOnTop,
    });
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    video.playbackRate = speed;
  }, [volume, muted, speed, activeId]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_ENGINE_STORAGE_KEY, engine);
  }, [engine]);

  useEffect(() => {
    if (mpvPath) {
      window.localStorage.setItem(MPV_PATH_STORAGE_KEY, mpvPath);
    } else {
      window.localStorage.removeItem(MPV_PATH_STORAGE_KEY);
    }
  }, [mpvPath]);

  useEffect(() => {
    if (engine !== 'mpv' || mpvStatus || checkingMpv) return;
    void checkMpv();
  }, [checkMpv, checkingMpv, engine, mpvStatus]);

  useEffect(() => {
    if (!activeItem || activeItem.source === 'url' || probeByPath[activeItem.path]) return;
    void probeMedia(activeItem, true);
  }, [activeItem, probeByPath, probeMedia]);

  useEffect(() => {
    void refreshAssociationStatus();
  }, [refreshAssociationStatus]);

  useEffect(() => {
    const takePending = async () => {
      try {
        const payload = await invoke<MediaOpenPayload | null>('media_take_pending_open', {
          request: { kind: 'video' },
        });
        if (!payload?.paths?.length) return;
        addPaths(payload.paths, 'file');
        setMessage(`已从系统打开 ${payload.paths.length} 个视频`);
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
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlay();
      } else if (event.code === 'ArrowLeft') {
        moveRelative(-5);
      } else if (event.code === 'ArrowRight') {
        moveRelative(5);
      } else if (event.key.toLowerCase() === 'm') {
        setMuted((current) => !current);
      } else if (event.key.toLowerCase() === 'f') {
        requestDisplayFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  useEffect(() => {
    if (!activeId || engine === 'mpv') return;
    const timer = window.setTimeout(() => {
      void playActive();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeId, engine, playActive]);

  const handleEnded = () => {
    setIsPlaying(false);
    if (repeatMode === 'one') {
      seekTo(0);
      void playActive();
      return;
    }
    if (autoNext && activeIndex + 1 < items.length) {
      playByOffset(1);
      return;
    }
    if (repeatMode === 'all' && items.length > 1) {
      playByOffset(1);
    }
  };

  if (!ready) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <ToolHeader
        icon="🎥"
        title="视频播放器"
        subtitle="本地和网络视频播放、播放列表、倍速、显示器全屏和迷你窗口"
        actions={
          <>
            <ToolbarButton onClick={() => void chooseFiles()}>
              <FolderOpen size={14} />
              打开视频
            </ToolbarButton>
            <ToolbarButton onClick={clearList} disabled={items.length === 0} danger>
              <Trash2 size={14} />
              清空列表
            </ToolbarButton>
          </>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div
            ref={stageRef}
            className="relative flex min-h-0 flex-1 items-center justify-center bg-black"
          >
            {activeItem && engine === 'native' ? (
              <video
                key={activeItem.id}
                ref={videoRef}
                src={activeItem.url}
                className="h-full w-full object-contain"
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  setDuration(video.duration || 0);
                  setVideoSize(
                    video.videoWidth && video.videoHeight
                      ? { width: video.videoWidth, height: video.videoHeight }
                      : null
                  );
                  video.volume = volume;
                  video.muted = muted;
                  video.playbackRate = speed;
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={handleEnded}
                onError={() =>
                  setError('当前视频无法播放，可能是不受 WebView 支持的编码或地址不可访问。')
                }
              >
                {externalSubtitles
                  .filter((path) => extension(path) === 'vtt')
                  .map((path, index) => (
                    <track
                      key={path}
                      src={convertFileSrc(path)}
                      kind="subtitles"
                      label={basename(path)}
                      default={index === 0}
                    />
                  ))}
              </video>
            ) : activeItem ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-8 text-center text-gray-200">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/10">
                  <Monitor size={30} />
                </div>
                <div className="max-w-2xl">
                  <div className="truncate text-lg font-semibold text-white">{activeItem.name}</div>
                  <div className="mt-2 text-sm text-gray-400">
                    MPV 外部引擎已启用，适合 MKV、H.265、多音轨、多字幕和 ASS/SRT 外挂字幕等格式。
                  </div>
                </div>
                <button
                  onClick={() => void openInMpv()}
                  disabled={launchingMpv}
                  className="inline-flex h-10 items-center gap-2 rounded bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <ExternalLink size={16} />
                  {launchingMpv ? '启动中' : '用 MPV 打开'}
                </button>
                {mpvStatus && (
                  <div
                    className={`max-w-xl rounded px-3 py-2 text-xs ${
                      mpvStatus.installed
                        ? 'bg-white/10 text-gray-300'
                        : 'bg-red-500/15 text-red-200'
                    }`}
                  >
                    {mpvStatus.message}
                  </div>
                )}
                {!mpvStatus?.installed && (
                  <button
                    onClick={openMpvInstallGuide}
                    className="inline-flex h-9 items-center gap-2 rounded border border-white/15 px-3 text-xs font-semibold text-gray-100 hover:bg-white/10"
                  >
                    <Info size={14} />
                    查看安装说明
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => void chooseFiles()}
                className="flex h-full w-full flex-col items-center justify-center gap-3 text-gray-400 hover:bg-gray-950"
              >
                <Film size={42} />
                <span className="text-sm font-semibold">打开或拖入视频</span>
                <span className="text-xs text-gray-500">MP4 / WebM / MOV / MKV / AVI</span>
              </button>
            )}

            {activeItem && (
              <div className="pointer-events-none absolute left-4 top-4 max-w-[70%] rounded bg-black/50 px-3 py-2 text-white">
                <div className="truncate text-sm font-semibold">{activeItem.name}</div>
                <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-gray-300">
                  <span>
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                  {videoSize && (
                    <span>
                      {videoSize.width} x {videoSize.height}
                    </span>
                  )}
                  <span>{speed}x</span>
                  {activeProbe && (
                    <span>
                      {activeProbe.audioTracks.length} 音轨 / {activeProbe.subtitleTracks.length}{' '}
                      字幕
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.05}
              value={Math.min(currentTime, duration || currentTime)}
              onChange={(event) => seekTo(Number(event.target.value))}
              disabled={!activeItem || !duration || engine === 'mpv'}
              className="h-2 w-full accent-blue-600"
              title={`${progress.toFixed(1)}%`}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => playByOffset(-1)}
                disabled={items.length < 2}
                className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                title="上一个"
              >
                <SkipBack size={16} />
              </button>
              <button
                onClick={togglePlay}
                disabled={!activeItem}
                className="flex h-10 w-10 items-center justify-center rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                title={engine === 'mpv' ? '用 MPV 打开' : isPlaying ? '暂停' : '播放'}
              >
                {engine === 'native' && isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button
                onClick={() => playByOffset(1)}
                disabled={items.length < 2}
                className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                title="下一个"
              >
                <SkipForward size={16} />
              </button>
              <button
                onClick={() => moveRelative(-10)}
                disabled={!activeItem || engine === 'mpv'}
                className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                title="后退 10 秒"
              >
                <RotateCcw size={15} />
              </button>
              <button
                onClick={() => moveRelative(10)}
                disabled={!activeItem || engine === 'mpv'}
                className="flex h-9 w-9 items-center justify-center rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                title="前进 10 秒"
              >
                <Clock size={15} />
              </button>

              <div className="ml-2 flex items-center gap-2 rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
                <button
                  onClick={() => setMuted((current) => !current)}
                  className="text-gray-500 hover:text-blue-600"
                  title={muted ? '取消静音' : '静音'}
                >
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
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

              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="h-9 rounded border border-gray-200 bg-white px-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-950"
                title="倍速"
              >
                {SPEEDS.map((item) => (
                  <option key={item} value={item}>
                    {item}x
                  </option>
                ))}
              </select>

              <button
                onClick={() => setRepeatMode((current) => nextRepeatMode(current))}
                className={`flex h-9 items-center gap-1.5 rounded border px-3 text-xs ${
                  repeatMode === 'off'
                    ? 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                    : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200'
                }`}
                title={repeatLabel(repeatMode)}
              >
                <Repeat size={14} />
                {repeatMode === 'one' ? '单曲' : repeatMode === 'all' ? '循环' : '顺序'}
              </button>
              <label className="flex h-9 items-center gap-2 rounded border border-gray-200 px-3 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={autoNext}
                  onChange={(event) => setAutoNext(event.target.checked)}
                />
                连播
              </label>

              <button
                onClick={() => void openInMpv()}
                disabled={!activeItem || launchingMpv}
                className="ml-auto flex h-9 items-center gap-1.5 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                title="用 MPV 外部引擎打开"
              >
                <ExternalLink size={14} />
                MPV
              </button>
              <button
                onClick={openMiniWindow}
                disabled={!activeItem || launchingMpv}
                className="flex h-9 items-center gap-1.5 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                title="打开 MPV 迷你窗口"
              >
                <Minimize2 size={14} />
                迷你窗口
              </button>
              <button
                onClick={requestDisplayFullscreen}
                disabled={!activeItem || launchingMpv}
                className="flex h-9 items-center gap-1.5 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
                title="用 MPV 打开显示器全屏"
              >
                <Maximize2 size={14} />
                显示器全屏
              </button>
            </div>
            {(message || error) && (
              <div
                className={`mt-2 rounded px-3 py-2 text-xs ${
                  error
                    ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                    : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                }`}
              >
                {error || message}
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 p-3 dark:border-gray-800">
            <div className="flex gap-2">
              <button
                onClick={() => void chooseFiles()}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={14} />
                添加文件
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded border border-gray-200 px-2 dark:border-gray-700">
                <Link size={14} className="text-gray-400" />
                <input
                  value={urlInput}
                  onChange={(event) => setUrlInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addUrl();
                  }}
                  placeholder="https://..."
                  className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
              </div>
              <button
                onClick={addUrl}
                className="h-8 rounded border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                加入
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded border border-gray-200 px-2 dark:border-gray-700">
              <Search size={14} className="text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索播放列表"
                className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </div>
            <div className="mt-3 rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
              <div className="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-200">
                <Settings2 size={14} />
                播放引擎
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 rounded bg-gray-100 p-1 dark:bg-gray-800">
                {(['native', 'mpv'] as PlayerEngine[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setEngine(mode)}
                    className={`h-8 rounded text-xs font-semibold ${
                      engine === mode
                        ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-950 dark:text-blue-300'
                        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                  >
                    {mode === 'native' ? '原生' : 'MPV'}
                  </button>
                ))}
              </div>
              {engine === 'mpv' && (
                <div className="mt-2 space-y-2">
                  <div
                    className={`rounded px-2 py-1.5 text-[11px] ${
                      mpvStatus?.installed
                        ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                        : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                    }`}
                  >
                    <div className="truncate">
                      {checkingMpv ? '正在检测 MPV...' : mpvStatus?.message || '尚未检测 MPV'}
                    </div>
                    {(mpvStatus?.path || mpvPath) && (
                      <div className="mt-1 truncate text-gray-500 dark:text-gray-400">
                        {mpvStatus?.path || mpvPath}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => void checkMpv()}
                      disabled={checkingMpv}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <RefreshCw size={13} />
                      检测
                    </button>
                    <button
                      onClick={() => void chooseMpvPath()}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <FolderOpen size={13} />
                      选择
                    </button>
                  </div>
                  {!mpvStatus?.installed && (
                    <button
                      onClick={openMpvInstallGuide}
                      className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
                    >
                      <Info size={13} />
                      MPV 安装说明
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
              <div className="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-200">
                <Minimize2 size={14} />
                迷你窗口
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1">
                {[
                  { label: '360p', width: 640, height: 360 },
                  { label: '480p', width: 854, height: 480 },
                  { label: '270p', width: 480, height: 270 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setMiniSize({ width: preset.width, height: preset.height })}
                    className={`h-7 rounded border text-[11px] ${
                      miniSize.width === preset.width && miniSize.height === preset.height
                        ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200'
                        : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={240}
                  max={1920}
                  value={miniSize.width}
                  onChange={(event) =>
                    setMiniSize((current) =>
                      normalizeMiniSize(Number(event.target.value), current.height)
                    )
                  }
                  className="h-8 min-w-0 rounded border border-gray-200 bg-white px-2 text-[11px] outline-none dark:border-gray-700 dark:bg-gray-950"
                  title="宽度"
                />
                <input
                  type="number"
                  min={135}
                  max={1080}
                  value={miniSize.height}
                  onChange={(event) =>
                    setMiniSize((current) =>
                      normalizeMiniSize(current.width, Number(event.target.value))
                    )
                  }
                  className="h-8 min-w-0 rounded border border-gray-200 bg-white px-2 text-[11px] outline-none dark:border-gray-700 dark:bg-gray-950"
                  title="高度"
                />
              </div>
              <label className="mt-2 flex h-8 items-center gap-2 rounded border border-gray-200 px-2 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={miniAlwaysOnTop}
                  onChange={(event) => setMiniAlwaysOnTop(event.target.checked)}
                />
                置顶
              </label>
              <button
                onClick={openMiniWindow}
                disabled={!activeItem || launchingMpv}
                className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <ExternalLink size={13} />
                打开
              </button>
            </div>
            <div className="mt-3 rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-200">
                  <Waves size={14} />
                  轨道 / 字幕
                </div>
                <button
                  onClick={() => void probeMedia()}
                  disabled={!activeItem || activeItem.source === 'url' || probing}
                  className="inline-flex h-7 items-center gap-1 rounded border border-gray-200 px-2 text-[11px] hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  title="扫描音轨和字幕轨"
                >
                  <RefreshCw size={12} />
                  {probing ? '扫描中' : '扫描'}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  value={selectedAudioTrack}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedAudioTrack(value === 'auto' ? 'auto' : Number(value));
                  }}
                  disabled={!activeItem}
                  className="h-8 min-w-0 rounded border border-gray-200 bg-white px-2 text-[11px] outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
                  title="音轨"
                >
                  <option value="auto">音轨自动</option>
                  {(activeProbe?.audioTracks || []).map((track) => (
                    <option key={track.streamIndex} value={track.ordinal}>
                      {formatTrackLabel(track, 'audio')}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedSubtitleTrack}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedSubtitleTrack(
                      value === 'auto' || value === 'off' ? value : Number(value)
                    );
                  }}
                  disabled={!activeItem}
                  className="h-8 min-w-0 rounded border border-gray-200 bg-white px-2 text-[11px] outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950"
                  title="字幕轨"
                >
                  <option value="auto">字幕自动</option>
                  <option value="off">关闭字幕</option>
                  {(activeProbe?.subtitleTracks || []).map((track) => (
                    <option key={track.streamIndex} value={track.ordinal}>
                      {formatTrackLabel(track, 'subtitle')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => void chooseSubtitles()}
                  disabled={!activeItem}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <Subtitles size={13} />
                  外挂字幕
                </button>
                <button
                  onClick={() => setExternalSubtitles([])}
                  disabled={externalSubtitles.length === 0}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <X size={13} />
                  清空字幕
                </button>
              </div>
              <div className="mt-2 rounded bg-gray-50 px-2 py-1.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                {activeItem?.source === 'url'
                  ? '网络视频暂不扫描本地轨道，MPV 会按媒体自身信息自动选择。'
                  : activeProbe
                    ? activeProbe.message
                    : '选择本地视频后会自动扫描音轨、字幕轨和同名外挂字幕。'}
              </div>
              {activeProbe?.videoTracks?.length ? (
                <div className="mt-2 space-y-1">
                  {activeProbe.videoTracks.slice(0, 2).map((track) => (
                    <div
                      key={track.streamIndex}
                      className="truncate rounded border border-gray-100 px-2 py-1 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400"
                    >
                      {formatTrackLabel(track, 'video')}
                    </div>
                  ))}
                </div>
              ) : null}
              {externalSubtitles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {externalSubtitles.map((path) => (
                    <div
                      key={path}
                      className="grid grid-cols-[16px_minmax(0,1fr)_20px] items-center gap-1 rounded border border-gray-100 px-2 py-1 text-[11px] dark:border-gray-800"
                    >
                      <FileText size={12} className="text-gray-400" />
                      <span className="truncate" title={path}>
                        {basename(path)}
                      </span>
                      <button
                        onClick={() => removeSubtitle(path)}
                        className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        title="移除字幕"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-3 rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700">
              <div className="flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-200">
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
                <div>{associationStatus?.message || '检测 Windows 打开方式注册状态'}</div>
                <div className="mt-1 line-clamp-2 text-gray-500 dark:text-gray-400">
                  {(associationStatus?.extensions || VIDEO_EXTENSIONS.map((item) => `.${item}`))
                    .slice(0, 8)
                    .join(' / ')}
                  {(associationStatus?.extensions?.length || VIDEO_EXTENSIONS.length) > 8
                    ? ' ...'
                    : ''}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => void registerVideoAssociation()}
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
                  默认应用
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {filteredItems.map((item, index) => {
              const active = item.id === activeId;
              return (
                <div
                  key={item.id}
                  className={`group mb-1 grid grid-cols-[32px_minmax(0,1fr)_28px] items-center gap-2 rounded-md px-2 py-2 text-xs ${
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (engine === 'mpv') {
                        void openInMpv(item);
                      } else {
                        selectItem(item.id);
                      }
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                    title={engine === 'mpv' ? '用 MPV 打开' : '播放'}
                  >
                    {engine === 'native' && active && isPlaying ? (
                      <Pause size={13} />
                    ) : (
                      <Play size={13} />
                    )}
                  </button>
                  <button onClick={() => selectItem(item.id)} className="min-w-0 text-left">
                    <span className="block truncate font-semibold">{item.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                      {index + 1} ·{' '}
                      {item.source === 'url'
                        ? 'URL'
                        : extension(item.path).toUpperCase() || 'VIDEO'}{' '}
                      · {formatDate(item.addedAt)}
                    </span>
                  </button>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="flex h-7 w-7 items-center justify-center rounded text-gray-400 opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/20"
                    title="移除"
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            {items.length === 0 && <EmptyState icon={<Film size={32} />} text="播放列表为空" />}
            {items.length > 0 && filteredItems.length === 0 && (
              <EmptyState icon={<Search size={32} />} text="没有匹配视频" />
            )}
          </div>

          <div className="border-t border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-800">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-gray-200 p-2 dark:border-gray-800">
                <div>列表</div>
                <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">
                  {items.length}
                </div>
              </div>
              <div className="rounded border border-gray-200 p-2 dark:border-gray-800">
                <div>当前</div>
                <div className="mt-1 truncate font-semibold text-gray-900 dark:text-gray-100">
                  {activeIndex >= 0 ? activeIndex + 1 : '-'}
                </div>
              </div>
            </div>
            {activeItem && (
              <div className="mt-3 rounded border border-gray-200 p-2 dark:border-gray-800">
                <div className="mb-1 flex items-center gap-1 font-semibold text-gray-600 dark:text-gray-300">
                  <Info size={13} />
                  媒体信息
                </div>
                <div className="space-y-1">
                  <div className="truncate">名称：{activeItem.name}</div>
                  <div>时长：{formatTime(duration)}</div>
                  <div>进度：{formatTime(currentTime)}</div>
                  {videoSize && (
                    <div>
                      尺寸：{videoSize.width} x {videoSize.height}
                    </div>
                  )}
                  {activeProbe && (
                    <>
                      <div>
                        轨道：{activeProbe.audioTracks.length} 音轨 /{' '}
                        {activeProbe.subtitleTracks.length} 字幕
                      </div>
                      <div>外挂字幕：{externalSubtitles.length}</div>
                    </>
                  )}
                  <div className="truncate">
                    来源：{activeItem.source === 'url' ? '网络地址' : activeItem.path}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>

      {mpvGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-[560px] rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Monitor size={18} className="text-blue-600 dark:text-blue-300" />
                  内置 MPV 播放核心未就绪
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  正常发布包会自带 MPV
                  压缩运行时。首次使用会自动解压到本地缓存，缓存被清除后会重新解压。
                </p>
              </div>
              <button
                onClick={() => setMpvGuideOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4 text-sm text-gray-700 dark:text-gray-200">
              <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-200">
                目标状态是软件内置 MPV，用户不需要单独安装。下面入口只作为资源缺失时的兜底处理。
              </div>

              <div className="grid gap-2">
                {[
                  '确认发布包内包含 resources/mpv/mpv-runtime.7z。',
                  '首次检测 MPV 时会自动解压到 AppData/McStartUP/media-runtime/mpv。',
                  '如果临时资源缺失，可以点击“选择 mpv.exe”手动指定。',
                  '点击“重新检测”，显示已找到内置 MPV 后再播放。',
                ].map((text, index) => (
                  <div key={text} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {index + 1}
                    </span>
                    <span className="leading-6">{text}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800">
                <div className="font-semibold text-gray-700 dark:text-gray-200">自动检测位置</div>
                <div className="mt-1 leading-5 text-gray-500 dark:text-gray-400">
                  工具会优先检测本地缓存；缓存不存在时从内置压缩包解压，再检测手动路径、PATH、
                  Program Files、Scoop 和 Chocolatey 作为兜底。
                </div>
              </div>

              {mpvPath && (
                <div className="truncate rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  当前手动路径：{mpvPath}
                </div>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button
                onClick={() => void openExternal(MPV_INSTALL_URL)}
                className="inline-flex h-9 items-center gap-1.5 rounded border border-gray-200 px-3 text-xs font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <ExternalLink size={14} />
                打开官方下载页
              </button>
              <button
                onClick={() => void chooseMpvPath()}
                className="inline-flex h-9 items-center gap-1.5 rounded border border-gray-200 px-3 text-xs font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <FolderOpen size={14} />
                选择 mpv.exe
              </button>
              <button
                onClick={() => void checkMpv()}
                disabled={checkingMpv}
                className="inline-flex h-9 items-center gap-1.5 rounded bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <RefreshCw size={14} />
                {checkingMpv ? '检测中' : '重新检测'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
