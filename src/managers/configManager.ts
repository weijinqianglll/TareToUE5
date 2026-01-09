import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface BuildConfig {
    uePath: string;
    projectPath: string;
    buildConfiguration: string;
}

export class ConfigManager {
    private _config: BuildConfig = {
        uePath: '',
        projectPath: '',
        buildConfiguration: 'Development'
    };

    private _view?: vscode.WebviewView;

    constructor(view?: vscode.WebviewView) {
        this._view = view;
    }

    public setView(view: vscode.WebviewView) {
        this._view = view;
    }

    public getConfig(): BuildConfig {
        return { ...this._config };
    }

    public updateConfig(config: Partial<BuildConfig>) {
        this._config = { ...this._config, ...config };
        this._sendConfigToWebview();
    }

    public setUEPath(uePath: string) {
        this._config.uePath = uePath;
        this._sendConfigToWebview();
    }

    public setProjectPath(projectPath: string) {
        this._config.projectPath = projectPath;
        this._sendConfigToWebview();
    }

    public setBuildConfiguration(buildConfiguration: string) {
        this._config.buildConfiguration = buildConfiguration;
        this._sendConfigToWebview();
    }

    public validateConfig(): { valid: boolean; error?: string } {
        if (!this._config.uePath) {
            return { valid: false, error: 'UE5 编辑器路径未设置' };
        }

        if (!fs.existsSync(this._config.uePath)) {
            return { valid: false, error: 'UE5 编辑器路径不存在' };
        }

        if (!this._config.projectPath) {
            return { valid: false, error: 'UE 项目路径未设置' };
        }

        if (!fs.existsSync(this._config.projectPath)) {
            return { valid: false, error: 'UE 项目路径不存在' };
        }

        return { valid: true };
    }

    public getProjectDir(): string {
        return path.dirname(this._config.projectPath);
    }

    public getProjectName(): string {
        return path.basename(this._config.projectPath, '.uproject');
    }

    public getSolutionPath(): string {
        const projectDir = this.getProjectDir();
        const projectName = this.getProjectName();
        return path.join(projectDir, `${projectName}.sln`);
    }

    public getUEEngineDir(): string {
        return path.dirname(this._config.uePath);
    }

    public getUBTPath(): string {
        const ueEnginePath = this._config.uePath;
        const engineRootDir = path.dirname(path.dirname(path.dirname(path.dirname(ueEnginePath))));
        return path.join(engineRootDir, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
    }

    private _sendConfigToWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                uePath: this._config.uePath,
                projectPath: this._config.projectPath,
                buildConfiguration: this._config.buildConfiguration
            });
        }
    }
}
