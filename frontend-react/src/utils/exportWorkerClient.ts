import {
  CSV_BOM,
  ExportFormat,
  downloadFile,
  exportRecordsToCsv,
  type ExportRecord,
} from './exportUtils';
import type { ExportWorkerResponse } from '../workers/exportWorker';

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (content: string) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;

  try {
    worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    workerBroken = true;
    return null;
  }

  worker.addEventListener('message', (event: MessageEvent<ExportWorkerResponse>) => {
    const task = pending.get(event.data?.id);
    if (!task) return;
    pending.delete(event.data.id);
    if (event.data.ok && typeof event.data.content === 'string') {
      task.resolve(event.data.content);
    } else {
      task.reject(new Error(event.data.error || '导出序列化失败'));
    }
  });

  worker.addEventListener('error', () => {
    workerBroken = true;
    const tasks = Array.from(pending.values());
    pending.clear();
    tasks.forEach((task) => task.reject(new Error('导出 Worker 异常')));
    worker?.terminate();
    worker = null;
  });

  return worker;
}

function serializeOnMainThread(records: ExportRecord[], format: ExportFormat): string {
  return format === ExportFormat.CSV
    ? CSV_BOM + exportRecordsToCsv(records)
    : JSON.stringify(records, null, 2);
}

function serializeExport(records: ExportRecord[], format: ExportFormat): Promise<string> {
  const instance = getWorker();
  if (!instance) return Promise.resolve(serializeOnMainThread(records, format));

  return new Promise<string>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    // Zustand 数据为普通对象，可直接 structured clone（Vue 版需先 deepToRaw 解响应式 Proxy）
    instance.postMessage({ id, format, records });
  });
}

/**
 * 在 Web Worker 中序列化导出数据（JSON/CSV）后触发下载，避免大数据量阻塞主线程；
 * Worker 不可用或异常时自动退化为主线程序列化。
 */
export async function performExportInWorker(
  records: ExportRecord[],
  format: ExportFormat,
  baseFilename: string,
): Promise<void> {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const extension = format === ExportFormat.CSV ? 'csv' : 'json';
  const filename = `${baseFilename}_${timestamp}.${extension}`;
  const mimeType =
    format === ExportFormat.CSV ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';

  let content: string;
  try {
    content = await serializeExport(records, format);
  } catch {
    // Worker 异常时退化，保证导出功能始终可用
    content = serializeOnMainThread(records, format);
  }
  downloadFile(content, filename, mimeType);
}
