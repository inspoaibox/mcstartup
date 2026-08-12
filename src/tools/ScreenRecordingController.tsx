import { useEffect, useState } from 'react';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { Maximize2, Pause, Play, StopCircle, Video } from 'lucide-react';

interface RecordingStatus {
  active: boolean;
  paused: boolean;
  sourceMode?: 'fullscreen' | 'region' | 'window';
  audioMode?: 'none' | 'microphone' | 'system' | 'mixed';
  outputPath?: string;
  elapsedMs: number;
  pausedMs: number;
}

interface StopResult {
  outputPath: string;
  fileSize?: number;
  elapsedMs: number;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => part.toString().padStart(2, '0')).join(':');
}

export default function ScreenRecordingController() {
  const [status, setStatus] = useState<RecordingStatus>({
    active: true,
    paused: false,
    elapsedMs: 0,
    pausedMs: 0,
  });
  const [stopping, setStopping] = useState(false);
  const [togglingPause, setTogglingPause] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = async () => {
    try {
      const next = await invoke<RecordingStatus>('screen_recording_get_status');
      setStatus(next);
      if (!next.active) {
        await appWindow.close();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    void invoke('screen_recording_set_window_capture_excluded', {
      label: appWindow.label,
      enable: true,
    }).catch(() => undefined);
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stopRecording = async () => {
    setStopping(true);
    setError('');
    try {
      const result = await invoke<StopResult>('screen_recording_stop');
      await emit('screen-recording-stopped', result);
      await appWindow.close();
    } catch (err) {
      const message = String(err);
      setError(message);
      await emit('screen-recording-stop-error', message);
    } finally {
      setStopping(false);
    }
  };

  const reopenMain = async () => {
    await emit('screen-recording-main-requested');
  };

  const togglePause = async () => {
    setTogglingPause(true);
    setError('');
    try {
      const next = await invoke<RecordingStatus>(
        status.paused ? 'screen_recording_resume' : 'screen_recording_pause'
      );
      setStatus(next);
    } catch (err) {
      const message = String(err);
      setError(message);
      await emit('screen-recording-stop-error', message);
    } finally {
      setTogglingPause(false);
    }
  };

  return (
    <div className="h-screen select-none overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
      <div className="flex h-full items-center gap-3 px-3" data-tauri-drag-region>
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
          data-tauri-drag-region
        >
          <Video size={18} />
        </div>
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <span
              className={`h-2 w-2 rounded-full ${
                status.paused ? 'bg-amber-500' : 'animate-pulse bg-red-500'
              }`}
            />
            <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-50">
              {formatDuration(status.elapsedMs)}
            </span>
          </div>
          <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
            {error ||
              `${status.paused ? '已暂停' : '录制中'} · ${
                status.sourceMode === 'window'
                  ? '窗口'
                  : status.sourceMode === 'region'
                    ? '区域'
                    : '全屏'
              } · ${
                status.audioMode === 'microphone'
                  ? '麦克风'
                  : status.audioMode === 'system'
                    ? '系统声音'
                    : status.audioMode === 'mixed'
                      ? '混音'
                      : '无音频'
              }`}
          </div>
        </div>
        <button
          onClick={reopenMain}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-800"
          title="显示主面板"
        >
          <Maximize2 size={16} />
        </button>
        <button
          onClick={togglePause}
          disabled={togglingPause}
          className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-amber-500 disabled:opacity-50 dark:hover:bg-gray-800"
          title={status.paused ? '继续录制' : '暂停录制'}
        >
          {status.paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button
          onClick={stopRecording}
          disabled={stopping}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          title="停止录制"
        >
          <StopCircle size={15} />
          停止
        </button>
      </div>
    </div>
  );
}
