import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ConfigManager } from './managers/configManager';
import { BuildManager } from './managers/buildManager';
import { DebugManager } from './managers/debugManager';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    console.log('UE Builder extension is now active!');

    const provider = new UEBuilderPanelProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('ueBuilderPanel', provider)
    );
}

class UEBuilderPanelProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    private _isDetecting: boolean = false;
    private _detectionInterval?: NodeJS.Timeout;
    private _projectDetected: boolean = false;
    private _configManager: ConfigManager;
    private _buildManager: BuildManager;
    private _debugManager: DebugManager;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._configManager = new ConfigManager();
        this._buildManager = new BuildManager(this._configManager);
        this._debugManager = new DebugManager(this._configManager);
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('[UE Builder] resolveWebviewView called');
        this._view = webviewView;
        this._configManager.setView(webviewView);
        this._buildManager.setView(webviewView);
        this._debugManager.setView(webviewView);

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = await this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            console.log('[UE Builder] Received message:', data.type);
            switch (data.type) {
                case 'selectUEPath':
                    await selectUEPath();
                    this._refresh();
                    break;
                case 'selectProjectPath':
                    await selectProjectPath();
                    this._refresh();
                    break;
                case 'cleanSolution':
                    await this._cleanSolution();
                    break;
                case 'regenerateSolution':
                    await this._regenerateSolution();
                    break;
                case 'generateSolution':
                    await this._generateSolution();
                    break;
                case 'startDebug':
                    await this._startDebug();
                    break;
                case 'startWithoutDebug':
                    await this._startWithoutDebug();
                    break;
                case 'launchProject':
                    await this._launchProject();
                    break;
                case 'cancelBuild':
                    this._buildManager.cancelBuild();
                    break;
                case 'cancelDebug':
                    this._debugManager.cancelDebug();
                    break;
                case 'refresh':
                    this._refresh();
                    break;
                case 'redetect':
                    await this._redetectProject();
                    break;
            }
        });

        webviewView.onDidChangeVisibility(() => {
            console.log('[UE Builder] Visibility changed, visible:', webviewView.visible);
            if (webviewView.visible) {
                this._refresh();
            }
        });

        this._refresh();
    }

    private async _cleanSolution() {
        await this._buildManager.cleanSolution();
    }

    private async _regenerateSolution() {
        await this._buildManager.regenerateSolution();
    }

    private async _generateSolution() {
        await this._buildManager.generateSolution();
    }

    private async _startDebug() {
        await this._debugManager.startDebug();
    }

    private async _startWithoutDebug() {
        await this._debugManager.startWithoutDebug();
    }

    private async _launchProject() {
        await this._debugManager.launchProject();
    }

    private async _redetectProject() {
        if (!this._view) {
            return;
        }

        console.log('[UE Builder] Manual redetection requested');
        this._projectDetected = false;
        await this._refresh();
    }

    private _stopDetection() {
        if (this._detectionInterval) {
            clearInterval(this._detectionInterval);
            this._detectionInterval = undefined;
            console.log('[UE Builder] Stopped continuous detection');
        }
    }

    private async _refresh() {
        if (!this._view) {
            console.log('[UE Builder] _refresh: view is not available');
            return;
        }

        console.log('[UE Builder] _refresh called');
        
        const config = vscode.workspace.getConfiguration('ueBuilder');
        let uePath = config.get<string>('uePath', '');
        let projectPath = config.get<string>('projectPath', '');
        const buildConfiguration = config.get<string>('buildConfiguration', 'Development');

        console.log('[UE Builder] Read config - uePath:', uePath);
        console.log('[UE Builder] Read config - projectPath:', projectPath);
        console.log('[UE Builder] Read config - buildConfiguration:', buildConfiguration);

        if (!projectPath) {
            console.log('[UE Builder] projectPath is empty, attempting auto-detection');
            
            this._view.webview.postMessage({
                type: 'update',
                uePath,
                projectPath: '检测中...',
                buildConfiguration
            });

            this._isDetecting = true;
            
            const detectedProjectPath = await findUEProjectGlobally();
            this._isDetecting = false;

            console.log('[UE Builder] Global detection result:', detectedProjectPath);
            
            if (detectedProjectPath) {
                projectPath = detectedProjectPath;
                this._projectDetected = true;
                console.log('[UE Builder] Saving projectPath to Workspace config:', projectPath);
                
                try {
                    await vscode.workspace.getConfiguration('ueBuilder').update('projectPath', projectPath, vscode.ConfigurationTarget.Workspace);
                    console.log('[UE Builder] Save completed');
                    
                    const updatedConfig = vscode.workspace.getConfiguration('ueBuilder');
                    const reReadProjectPath = updatedConfig.get<string>('projectPath', '');
                    console.log('[UE Builder] Re-read projectPath after save:', reReadProjectPath);
                    console.log('[UE Builder] projectPath match:', reReadProjectPath === projectPath);
                    
                    if (reReadProjectPath === projectPath) {
                        projectPath = reReadProjectPath;
                    }
                } catch (error) {
                    console.error('[UE Builder] Error saving projectPath:', error);
                }
            } else {
                console.log('[UE Builder] No UE project found globally, starting continuous detection');
                
                if (!this._detectionInterval && !this._projectDetected) {
                    this._detectionInterval = setInterval(async () => {
                        console.log('[UE Builder] Continuous detection - checking for project...');
                        const config = vscode.workspace.getConfiguration('ueBuilder');
                        const currentProjectPath = config.get<string>('projectPath', '');
                        
                        if (currentProjectPath) {
                            console.log('[UE Builder] Project already detected, stopping continuous detection');
                            this._stopDetection();
                            this._projectDetected = true;
                            this._refresh();
                            return;
                        }
                        
                        const detectedPath = await findUEProjectGlobally();
                        if (detectedPath) {
                            console.log('[UE Builder] Project found during continuous detection:', detectedPath);
                            this._stopDetection();
                            this._projectDetected = true;
                            
                            try {
                                await vscode.workspace.getConfiguration('ueBuilder').update('projectPath', detectedPath, vscode.ConfigurationTarget.Workspace);
                            } catch (error) {
                                console.error('[UE Builder] Error saving projectPath:', error);
                            }
                            
                            this._refresh();
                        }
                    }, 5000);
                }
            }
        } else {
            console.log('[UE Builder] projectPath already set:', projectPath);
            this._projectDetected = true;
            this._stopDetection();
        }

        this._configManager.updateConfig({
            uePath,
            projectPath,
            buildConfiguration
        });

        console.log('[UE Builder] Sending update message - projectPath:', projectPath);
        this._view.webview.postMessage({
            type: 'update',
            uePath,
            projectPath,
            buildConfiguration
        });
    }

    private async _getHtmlForWebview(webview: vscode.Webview) {
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'index.html');
        const htmlContent = await vscode.workspace.fs.readFile(htmlPath);
        let html = Buffer.from(htmlContent).toString('utf8');

        html = html.replace('webview.css', webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'style.css')).toString());
        
        return html;
    }
}

async function selectUEPath() {
    const uePath = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'UE5 Editor': ['exe']
        },
        title: 'Select UE5 Editor'
    });

    if (uePath && uePath[0]) {
        const selectedPath = uePath[0].fsPath;
        await vscode.workspace.getConfiguration('ueBuilder').update('uePath', selectedPath, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`UE5 Editor path set to: ${selectedPath}`);
    }
}

async function selectProjectPath() {
    const projectPath = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'UE Project': ['uproject']
        },
        title: 'Select UE Project'
    });

    if (projectPath && projectPath[0]) {
        const selectedPath = projectPath[0].fsPath;
        await vscode.workspace.getConfiguration('ueBuilder').update('projectPath', selectedPath, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`UE Project path set to: ${selectedPath}`);
    }
}

async function findUEProjectGlobally(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    try {
        const { stdout } = await execAsync(`dir /s /b "${workspaceRoot}\\*.uproject"`, { 
            maxBuffer: 1024 * 1024 * 10 
        });
        
        const projects = stdout.split('\n').filter(line => line.trim().length > 0);
        
        if (projects.length === 1) {
            return projects[0].trim();
        } else if (projects.length > 1) {
            return projects[0].trim();
        }
    } catch (error) {
        console.error('[UE Builder] Error searching for UE project:', error);
    }

    return null;
}

export function deactivate() {
    console.log('UE Builder extension is now deactivated');
}
