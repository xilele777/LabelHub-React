import { CSV_BOM, ExportFormat, exportRecordsToCsv, type ExportRecord } from '../utils/exportUtils';

export interface ExportWorkerRequest {
  id: number;
  format: ExportFormat;
  records: ExportRecord[];
}

export interface ExportWorkerResponse {
  id: number;
  ok: boolean;
  content?: string;
  error?: string;
}

// Worker 全局对象的最小类型（避免与 DOM lib 的 Window.postMessage 签名冲突）
const ctx = self as unknown as {
  postMessage(message: ExportWorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ExportWorkerRequest>) => void,
  ): void;
};

ctx.addEventListener('message', (event) => {
  const { id, format, records } = event.data;
  try {
    const content =
      format === ExportFormat.CSV
        ? CSV_BOM + exportRecordsToCsv(records)
        : JSON.stringify(records, null, 2);
    ctx.postMessage({ id, ok: true, content });
  } catch (error) {
    ctx.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
