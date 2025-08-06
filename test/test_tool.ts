import { exec } from 'child_process';

import { promisify } from 'util';

// 将 exec 转为 Promise 风格
const execAsync = promisify(exec);

async function runCommand(command: string): Promise<void> {
  try {
    const { stdout, stderr } = await execAsync(command);

    // 注意：Git 的信息性输出在 stderr，不一定是错误
    if (stderr) {
      console.warn(`[命令输出] ${command}:\n${stderr}`); // 用 warn 而不是 error
    }

    if (stdout) {
      console.log(`[命令输出] ${command}:\n${stdout}`);
    }
  } catch (error) {
    // 如果 exec 返回非零退出码（如命令不存在、git 失败），会走到这里
    console.error(`执行失败: ${command}`);
    console.error('错误:', error);
    throw error; // 抛出错误，让调用者能处理
  }
}

export { runCommand }