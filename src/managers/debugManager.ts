import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, exec } from 'child_process';
import { ConfigManager, BuildConfig } from './configManager';

export class DebugManager {
    private _debugProcess?: any;
    private _isDebugging: boolean = false;
    private _view?: vscode.WebviewView;
    private _configManager: ConfigManager;

    constructor(configManager: ConfigManager, view?: vscode.WebviewView) {
        this._configManager = configManager;
        this._view = view;
    }

    public setView(view: vscode.WebviewView) {
        this._view = view;
    }

    public isDebugging(): boolean {
        return this._isDebugging;
    }

    public cancelDebug() {
        if (this._debugProcess) {
            console.log('[DebugManager] Cancelling debug process...');
            try {
                spawn('taskkill', ['/F', '/T', '/PID', String(this._debugProcess.pid)]);
                
                console.log('[DebugManager] Debug process cancelled');
                this._isDebugging = false;
                this._debugProcess = undefined;
                
                if (this._view) {
                    this._view.webview.postMessage({ type: 'debugCancelled' });
                }
                
                vscode.window.showInformationMessage('操作已取消');
            } catch (error) {
                console.error('[DebugManager] Error cancelling debug:', error);
            }
        }
    }

    public async startDebug() {
        if (this._isDebugging) {
            vscode.window.showWarningMessage('已有操作正在进行中');
            return;
        }

        const config = this._configManager.getConfig();
        const validation = this._configManager.validateConfig();
        if (!validation.valid) {
            vscode.window.showErrorMessage(validation.error || '配置验证失败');
            return;
        }

        const projectPath = config.projectPath;
        const projectDir = this._configManager.getProjectDir();
        const projectName = this._configManager.getProjectName();
        const buildConfiguration = config.buildConfiguration;

        this._isDebugging = true;
        this._view?.webview.postMessage({ type: 'debugStarted' });

        const outputChannel = vscode.window.createOutputChannel('UE Builder');
        outputChannel.show();
        outputChannel.appendLine(`=== 开始调试 ===`);
        outputChannel.appendLine(`项目: ${projectName}`);
        outputChannel.appendLine(`配置: ${buildConfiguration}`);

        try {
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 10, message: '正在编译...' });

            outputChannel.appendLine('--- 编译项目 ---');
            await this._buildProject(config, outputChannel);

            this._view?.webview.postMessage({ type: 'buildProgress', progress: 50, message: '正在启动调试...' });

            outputChannel.appendLine('--- 启动调试 ---');
            const uePath = config.uePath;
            if (!uePath || !fs.existsSync(uePath)) {
                throw new Error('UE5 编辑器路径未设置或不存在');
            }

            const debugCommand = `"${uePath}" "${projectPath}" -debug`;
            outputChannel.appendLine(`执行命令: ${debugCommand}`);
            
            this._debugProcess = spawn('cmd', ['/c', debugCommand], { 
                cwd: projectDir,
                shell: true,
                detached: true
            });

            this._debugProcess.unref();
            this._debugProcess = undefined;
            this._isDebugging = false;

            this._view?.webview.postMessage({ type: 'buildProgress', progress: 100, message: '调试已启动' });

            outputChannel.appendLine('=== 调试已启动 ===');
            vscode.window.showInformationMessage('调试已启动');
            this._view?.webview.postMessage({ type: 'debugSuccess' });
        } catch (error: any) {
            this._isDebugging = false;
            this._debugProcess = undefined;
            
            const errorMessage = error.message || String(error);
            outputChannel.appendLine(`启动失败: ${errorMessage}`);
            vscode.window.showErrorMessage('启动失败! 查看输出面板了解详情');
            this._view?.webview.postMessage({ type: 'debugFailed', error: errorMessage });
        }
    }

    public async startWithoutDebug() {
        if (this._isDebugging) {
            vscode.window.showWarningMessage('已有操作正在进行中');
            return;
        }

        const config = this._configManager.getConfig();
        const validation = this._configManager.validateConfig();
        if (!validation.valid) {
            vscode.window.showErrorMessage(validation.error || '配置验证失败');
            return;
        }

        const projectPath = config.projectPath;
        const projectDir = this._configManager.getProjectDir();
        const projectName = this._configManager.getProjectName();
        const buildConfiguration = config.buildConfiguration;

        this._isDebugging = true;
        this._view?.webview.postMessage({ type: 'debugStarted' });

        const outputChannel = vscode.window.createOutputChannel('UE Builder');
        outputChannel.show();
        outputChannel.appendLine(`=== 开始执行(不调试) ===`);
        outputChannel.appendLine(`项目: ${projectName}`);
        outputChannel.appendLine(`配置: ${buildConfiguration}`);

        try {
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 10, message: '正在编译...' });

            outputChannel.appendLine('--- 编译项目 ---');
            await this._buildProject(config, outputChannel);

            this._view?.webview.postMessage({ type: 'buildProgress', progress: 50, message: '正在启动项目...' });

            outputChannel.appendLine('--- 启动项目 ---');
            const uePath = config.uePath;
            if (!uePath || !fs.existsSync(uePath)) {
                throw new Error('UE5 编辑器路径未设置或不存在');
            }

            const runCommand = `"${uePath}" "${projectPath}"`;
            outputChannel.appendLine(`执行命令: ${runCommand}`);
            
            exec(runCommand, { 
                cwd: projectDir,
                windowsHide: false
            }, (error) => {
                if (error) {
                    outputChannel.appendLine(`启动警告: ${error.message}`);
                }
            });

            this._debugProcess = undefined;
            this._isDebugging = false;

            this._view?.webview.postMessage({ type: 'buildProgress', progress: 100, message: '项目已启动' });

            outputChannel.appendLine('=== 项目已启动 ===');
            vscode.window.showInformationMessage('项目已启动');
            this._view?.webview.postMessage({ type: 'debugSuccess' });
        } catch (error: any) {
            this._isDebugging = false;
            this._debugProcess = undefined;
            
            const errorMessage = error.message || String(error);
            outputChannel.appendLine(`启动失败: ${errorMessage}`);
            vscode.window.showErrorMessage('启动失败! 查看输出面板了解详情');
            this._view?.webview.postMessage({ type: 'debugFailed', error: errorMessage });
        }
    }

    public async launchProject() {
        const config = this._configManager.getConfig();
        const projectPath = config.projectPath;
        const uePath = config.uePath;

        if (!projectPath || !fs.existsSync(projectPath)) {
            vscode.window.showErrorMessage('项目路径未设置或不存在');
            return;
        }

        if (!uePath || !fs.existsSync(uePath)) {
            vscode.window.showErrorMessage('UE5 编辑器路径未设置或不存在');
            return;
        }

        const outputChannel = vscode.window.createOutputChannel('UE Builder');
        outputChannel.show();
        outputChannel.appendLine(`=== 启动项目 ===`);
        outputChannel.appendLine(`项目: ${projectPath}`);

        try {
            const projectDir = this._configManager.getProjectDir();
            const runCommand = `"${uePath}" "${projectPath}"`;
            outputChannel.appendLine(`执行命令: ${runCommand}`);
            
            exec(runCommand, { 
                cwd: projectDir,
                windowsHide: false
            }, (error) => {
                if (error) {
                    outputChannel.appendLine(`启动警告: ${error.message}`);
                }
            });

            outputChannel.appendLine('=== 项目已启动 ===');
            vscode.window.showInformationMessage('项目已启动');
        } catch (error: any) {
            const errorMessage = error.message || String(error);
            outputChannel.appendLine(`启动失败: ${errorMessage}`);
            vscode.window.showErrorMessage('启动失败! 查看输出面板了解详情');
        }
    }

    private async _buildProject(config: BuildConfig, outputChannel: vscode.OutputChannel) {
        const projectPath = config.projectPath;
        const projectDir = this._configManager.getProjectDir();
        const projectName = this._configManager.getProjectName();
        const buildConfiguration = config.buildConfiguration;

        const ueEnginePath = config.uePath;
        const engineRootDir = path.dirname(path.dirname(path.dirname(path.dirname(ueEnginePath))));
        const buildBatPath = path.join(engineRootDir, 'Engine', 'Build', 'BatchFiles', 'Build.bat');

        if (!fs.existsSync(buildBatPath)) {
            throw new Error(`Build.bat not found at: ${buildBatPath}`);
        }

        outputChannel.appendLine(`执行: ${buildBatPath}`);
        outputChannel.appendLine(`参数: ${projectName}Editor Win64 ${buildConfiguration} -Project="${projectPath}" -WaitMutex -FromMsBuild -architecture=x64`);
        
        await this._executeProcess(buildBatPath, [`${projectName}Editor`, 'Win64', buildConfiguration, `-Project="${projectPath}"`, '-WaitMutex', '-FromMsBuild', '-architecture=x64'], projectDir, outputChannel);
    }

    private async _executeProcess(executable: string, args: string[], cwd: string, outputChannel: vscode.OutputChannel): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let childProcess: any;
            
            if (executable.endsWith('.bat')) {
                const quotedExecutable = `"${executable}"`;
                const quotedArgs = args.map(arg => arg.includes(' ') ? `"${arg}"` : arg);
                const command = `${quotedExecutable} ${quotedArgs.join(' ')}`;
                
                outputChannel.appendLine(`执行命令: ${command}`);
                
                childProcess = exec(command, { 
                    cwd: cwd,
                    windowsHide: true,
                    maxBuffer: 1024 * 1024 * 10
                });
            } else {
                childProcess = spawn(executable, args, { 
                    cwd: cwd,
                    shell: false,
                    windowsHide: true
                });
            }
            
            this._debugProcess = childProcess;

            let stdout = '';
            let stderr = '';
            let currentProgress = 0;

            this._debugProcess.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                outputChannel.append(text);

                const progress = this._parseProgress(text);
                if (progress > currentProgress) {
                    currentProgress = progress;
                    if (this._view) {
                        this._view.webview.postMessage({ 
                            type: 'buildProgress', 
                            progress: 10 + (progress * 0.4),
                            message: this._getProgressMessage(text, progress)
                        });
                    }
                }
            });

            this._debugProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                outputChannel.append(text);
            });

            this._debugProcess.on('close', (code: number) => {
                this._debugProcess = undefined;
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`进程退出，代码: ${code}\n${stderr}`));
                }
            });

            this._debugProcess.on('error', (error: Error) => {
                this._debugProcess = undefined;
                reject(error);
            });
        });
    }

    private _parseProgress(text: string): number {
        const match = text.match(/(\d+)%/);
        if (match) {
            return parseInt(match[1], 10);
        }
        return 0;
    }

    private _getProgressMessage(text: string, progress: number): string {
        if (text.includes('Compiling')) {
            return '正在编译...';
        } else if (text.includes('Linking')) {
            return '正在链接...';
        } else if (text.includes('Generating')) {
            return '正在生成...';
        }
        return '正在处理...';
    }
}
