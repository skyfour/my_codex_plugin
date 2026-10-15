import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认相对仓库定位；自定义相对目录则相对启动命令所在位置解析。
const directory = process.env.CODEX_UI_SCREENSHOT_DIR
  ? resolve(process.env.CODEX_UI_SCREENSHOT_DIR)
  : fileURLToPath(new URL('../test-results/local-review/', import.meta.url));

export async function screenshotPath(filename) {
  await mkdir(directory, { recursive: true });
  return join(directory, filename);
}
