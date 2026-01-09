import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, exec } from 'child_process';
import { ConfigManager, BuildConfig } from './configManager';

export class BuildManager {
    private _buildProcess?: any;
    private _isBuilding: boolean = false;
    private _view?: vscode.WebviewView;
    private _configManager: ConfigManager;

    constructor(configManager: ConfigManager, view?: vscode.WebviewView) {
        this._configManager = configManager;
        this._view = view;
    }

    public setView(view: vscode.WebviewView) {
        this._view = view;
    }

    public isBuilding(): boolean {
        return this._isBuilding;
    }

    public cancelBuild() {
        if (this._buildProcess) {
            console.log('[BuildManager] Cancelling build process...');
            try {
                spawn('taskkill', ['/F', '/T', '/PID', String(this._buildProcess.pid)]);
                
                console.log('[BuildManager] Build process cancelled');
                this._isBuilding = false;
                this._buildProcess = undefined;
                
                if (this._view) {
                    this._view.webview.postMessage({ type: 'buildCancelled' });
                }
                
                vscode.window.showInformationMessage('操作已取消');
            } catch (error) {
                console.error('[BuildManager] Error cancelling build:', error);
            }
        }
    }

    public async cleanSolution() {
        if (this._isBuilding) {
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

        this._isBuilding = true;
        this._view?.webview.postMessage({ type: 'buildStarted' });

        const outputChannel = vscode.window.createOutputChannel('UE Builder');
        outputChannel.show();
        outputChannel.appendLine(`=== 清理解决方案 ===`);
        outputChannel.appendLine(`项目: ${projectName}`);
        outputChannel.appendLine(`路径: ${projectPath}`);

        try {
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 10, message: '正在清理...' });
            
            outputChannel.appendLine('--- 删除 Intermediate 目录 ---');
            const intermediateDir = path.join(projectDir, 'Intermediate');
            if (fs.existsSync(intermediateDir)) {
                outputChannel.appendLine(`删除: ${intermediateDir}`);
                this._view?.webview.postMessage({ type: 'buildProgress', progress: 20, message: '正在删除 Intermediate...' });
                await fs.promises.rm(intermediateDir, { recursive: true, force: true, maxRetries: 3 });
            } else {
                outputChannel.appendLine('Intermediate 目录不存在');
            }
            
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 40, message: '正在清理...' });

            outputChannel.appendLine('--- 删除 Binaries 目录 ---');
            const binariesDir = path.join(projectDir, 'Binaries');
            if (fs.existsSync(binariesDir)) {
                outputChannel.appendLine(`删除: ${binariesDir}`);
                this._view?.webview.postMessage({ type: 'buildProgress', progress: 60, message: '正在删除 Binaries...' });
                await fs.promises.rm(binariesDir, { recursive: true, force: true, maxRetries: 3 });
            } else {
                outputChannel.appendLine('Binaries 目录不存在');
            }
            
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 70, message: '正在清理...' });

            outputChannel.appendLine('--- 删除 Saved/StagedBuilds 目录 ---');
            const savedStagingDir = path.join(projectDir, 'Saved', 'StagedBuilds');
            if (fs.existsSync(savedStagingDir)) {
                outputChannel.appendLine(`删除: ${savedStagingDir}`);
                this._view?.webview.postMessage({ type: 'buildProgress', progress: 85, message: '正在删除 StagedBuilds...' });
                await fs.promises.rm(savedStagingDir, { recursive: true, force: true, maxRetries: 3 });
            } else {
                outputChannel.appendLine('Saved/StagedBuilds 目录不存在');
            }
            
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 100, message: '正在清理...' });

            outputChannel.appendLine('=== 清理完成 ===');
            vscode.window.showInformationMessage('清理完成');
            this._isBuilding = false;
            this._buildProcess = undefined;
            this._view?.webview.postMessage({ type: 'buildSuccess' });
        } catch (error: any) {
            this._isBuilding = false;
            this._buildProcess = undefined;
            
            const errorMessage = error.message || String(error);
            outputChannel.appendLine(`清理失败: ${errorMessage}`);
            vscode.window.showErrorMessage('清理失败! 查看输出面板了解详情');
            this._view?.webview.postMessage({ type: 'buildFailed', error: errorMessage });
        }
    }

    public async regenerateSolution() {
        if (this._isBuilding) {
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
        const solutionPath = this._configManager.getSolutionPath();
        const buildConfiguration = config.buildConfiguration;

        this._isBuilding = true;
        this._view?.webview.postMessage({ type: 'buildStarted' });

        const outputChannel = vscode.window.createOutputChannel('UE Builder');
        outputChannel.show();
        outputChannel.appendLine(`=== 重新生成解决方案 ===`);
        outputChannel.appendLine(`项目: ${projectName}`);
        outputChannel.appendLine(`配置: ${buildConfiguration}`);

        try {
            await this._cleanSolutionInternal(outputChannel, projectDir);

            outputChannel.appendLine('--- 删除现有解决方案文件 ---');
            if (fs.existsSync(solutionPath)) {
                outputChannel.appendLine(`删除: ${solutionPath}`);
                fs.unlinkSync(solutionPath);
            } else {
                outputChannel.appendLine('解决方案文件不存在');
            }

            outputChannel.appendLine('--- 生成项目文件 ---');
            await this._generateProjectFiles(config, outputChannel);

            outputChannel.appendLine('--- 编译项目 ---');
            await this._buildProject(config, outputChannel);

            outputChannel.appendLine('=== 重新生成解决方案完成 ===');
            vscode.window.showInformationMessage('重新生成解决方案完成');
            this._isBuilding = false;
            this._buildProcess = undefined;
            this._view?.webview.postMessage({ type: 'buildSuccess' });
        } catch (error: any) {
            this._isBuilding = false;
            this._buildProcess = undefined;
            
            const errorMessage = error.message || String(error);
            outputChannel.appendLine(`操作失败: ${errorMessage}`);
            vscode.window.showErrorMessage('操作失败! 查看输出面板了解详情');
            this._view?.webview.postMessage({ type: 'buildFailed', error: errorMessage });
        }
    }

    public async generateSolution() {
        if (this._isBuilding) {
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
        const solutionPath = this._configManager.getSolutionPath();

        this._isBuilding = true;
        this._view?.webview.postMessage({ type: 'buildStarted' });

        const outputChannel = vscode.window.createOutputChannel('UE Builder');
        outputChannel.show();
        outputChannel.appendLine(`=== 生成解决方案 ===`);
        outputChannel.appendLine(`项目: ${projectName}`);

        try {
            outputChannel.appendLine('--- 删除现有解决方案文件 ---');
            if (fs.existsSync(solutionPath)) {
                outputChannel.appendLine(`删除: ${solutionPath}`);
                fs.unlinkSync(solutionPath);
            } else {
                outputChannel.appendLine('解决方案文件不存在');
            }

            outputChannel.appendLine('--- 生成项目文件 ---');
            await this._generateProjectFiles(config, outputChannel);

            outputChannel.appendLine('=== 生成解决方案完成 ===');
            vscode.window.showInformationMessage('生成解决方案完成');
            this._isBuilding = false;
            this._buildProcess = undefined;
            this._view?.webview.postMessage({ type: 'buildSuccess' });
        } catch (error: any) {
            this._isBuilding = false;
            this._buildProcess = undefined;
            
            const errorMessage = error.message || String(error);
            outputChannel.appendLine(`操作失败: ${errorMessage}`);
            vscode.window.showErrorMessage('操作失败! 查看输出面板了解详情');
            this._view?.webview.postMessage({ type: 'buildFailed', error: errorMessage });
        }
    }

    private async _cleanSolutionInternal(outputChannel: vscode.OutputChannel, projectDir: string) {
        this._view?.webview.postMessage({ type: 'buildProgress', progress: 10, message: '正在清理...' });
        
        outputChannel.appendLine('--- 清理中间文件 ---');
        
        const intermediateDir = path.join(projectDir, 'Intermediate');
        if (fs.existsSync(intermediateDir)) {
            outputChannel.appendLine(`删除: ${intermediateDir}`);
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 15, message: '正在删除 Intermediate...' });
            await fs.promises.rm(intermediateDir, { recursive: true, force: true, maxRetries: 3 });
        }

        this._view?.webview.postMessage({ type: 'buildProgress', progress: 20, message: '正在清理...' });

        const binariesDir = path.join(projectDir, 'Binaries');
        if (fs.existsSync(binariesDir)) {
            outputChannel.appendLine(`删除: ${binariesDir}`);
            this._view?.webview.postMessage({ type: 'buildProgress', progress: 25, message: '正在删除 Binaries...' });
            await fs.promises.rm(binariesDir, { recursive: true, force: true, maxRetries: 3 });
        }

        this._view?.webview.postMessage({ type: 'buildProgress', progress: 28, message: '正在清理...' });

        const savedStagingDir = path.join(projectDir, 'Saved', 'StagedBuilds');
        if (fs.existsSync(savedStagingDir)) {
            outputChannel.appendLine(`删除: ${savedStagingDir}`);
            await fs.promises.rm(savedStagingDir, { recursive: true, force: true, maxRetries: 3 });
        }
        
        this._view?.webview.postMessage({ type: 'buildProgress', progress: 30, message: '正在清理...' });
    }

    private async _generateProjectFiles(config: BuildConfig, outputChannel: vscode.OutputChannel) {
        const projectPath = config.projectPath;
        const projectDir = this._configManager.getProjectDir();
        const projectName = this._configManager.getProjectName();
        const ueEnginePath = config.uePath;
        const engineRootDir = path.dirname(path.dirname(path.dirname(path.dirname(ueEnginePath))));
        const ubtPath = path.join(engineRootDir, 'Engine', 'Build', 'BatchFiles', 'Build.bat');

        this._view?.webview.postMessage({ type: 'buildProgress', progress: 35, message: '正在生成项目文件...' });

        if (!fs.existsSync(ubtPath)) {
            throw new Error(`Build.bat not found at: ${ubtPath}`);
        }

        outputChannel.appendLine(`执行: ${ubtPath}`);
        outputChannel.appendLine(`参数: ${projectName}Editor Win64 Development -Project="${projectPath}" -WaitMutex -FromMsBuild -architecture=x64 -GenerateProjectFiles`);
        
        await this._executeProcess(ubtPath, [`${projectName}Editor`, 'Win64', 'Development', `-Project="${projectPath}"`, '-WaitMutex', '-FromMsBuild', '-architecture=x64', '-GenerateProjectFiles'], projectDir, outputChannel);
        
        this._view?.webview.postMessage({ type: 'buildProgress', progress: 60, message: '正在生成项目文件...' });
    }

    private async _buildProject(config: BuildConfig, outputChannel: vscode.OutputChannel) {
        const projectPath = config.projectPath;
        const projectDir = this._configManager.getProjectDir();
        const projectName = this._configManager.getProjectName();
        const buildConfiguration = config.buildConfiguration;

        this._view?.webview.postMessage({ type: 'buildProgress', progress: 65, message: '正在编译...' });

        const ueEnginePath = config.uePath;
        const engineRootDir = path.dirname(path.dirname(path.dirname(path.dirname(ueEnginePath))));
        const buildBatPath = path.join(engineRootDir, 'Engine', 'Build', 'BatchFiles', 'Build.bat');

        if (!fs.existsSync(buildBatPath)) {
            throw new Error(`Build.bat not found at: ${buildBatPath}`);
        }

        outputChannel.appendLine(`执行: ${buildBatPath}`);
        outputChannel.appendLine(`参数: ${projectName}Editor Win64 ${buildConfiguration} -Project="${projectPath}" -WaitMutex -FromMsBuild -architecture=x64`);
        
        await this._executeProcess(buildBatPath, [`${projectName}Editor`, 'Win64', buildConfiguration, `-Project="${projectPath}"`, '-WaitMutex', '-FromMsBuild', '-architecture=x64'], projectDir, outputChannel);
        
        this._view?.webview.postMessage({ type: 'buildProgress', progress: 100, message: '正在编译...' });
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
            
            this._buildProcess = childProcess;

            let stdout = '';
            let stderr = '';
            let currentProgress = 0;
            let startTime = Date.now();
            let estimatedDuration = 300000; // 默认5分钟

            this._buildProcess.stdout?.on('data', (data: Buffer) => {
                const text = data.toString();
                stdout += text;
                outputChannel.append(text);

                const progress = this._parseProgress(text);
                if (progress > currentProgress) {
                    currentProgress = progress;
                    if (this._view) {
                        this._view.webview.postMessage({ 
                            type: 'buildProgress', 
                            progress: currentProgress,
                            message: this._getProgressMessage(text, currentProgress)
                        });
                    }
                } else if (currentProgress > 0 && currentProgress < 100) {
                    // 如果没有明确的进度，基于时间估算
                    const elapsed = Date.now() - startTime;
                    const estimatedProgress = Math.min(95, 40 + (elapsed / estimatedDuration) * 55);
                    if (estimatedProgress > currentProgress) {
                        currentProgress = estimatedProgress;
                        if (this._view) {
                            this._view.webview.postMessage({ 
                                type: 'buildProgress', 
                                progress: currentProgress,
                                message: this._getProgressMessage(text, currentProgress)
                            });
                        }
                    }
                }
            });

            this._buildProcess.stderr?.on('data', (data: Buffer) => {
                const text = data.toString();
                stderr += text;
                outputChannel.append(text);
            });

            this._buildProcess.on('close', (code: number) => {
                this._buildProcess = undefined;
                
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`进程退出，代码: ${code}\n${stderr}`));
                }
            });

            this._buildProcess.on('error', (error: Error) => {
                this._buildProcess = undefined;
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
