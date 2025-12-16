export const GitDriver = {
    isAvailable: () => typeof window !== 'undefined' && !!window.electronAPI?.git,

    async clone(parentDir, url, folderName = '') {
        if (!this.isAvailable()) return { success: false, error: 'Git is not available' };
        if (typeof window.electronAPI.git.clone !== 'function') {
            return { success: false, error: 'Core component updated. Please restart the application to enable Clone.' };
        }
        try {
            const res = await window.electronAPI.git.clone(parentDir, url, folderName);
            return res || { success: false, error: 'Clone failed' };
        } catch (e) {
            console.error('Git clone failed', e);
            return { success: false, error: e.message || String(e) };
        }
    },

    async status(cwd) {
        if (!this.isAvailable()) return null;
        try {
            const res = await window.electronAPI.git.status(cwd);
            return res.success ? res.status : null;
        } catch (e) {
            console.error('Git status failed', e);
            return null;
        }
    },

    async stage(cwd, files) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.stage(cwd, files);
            return res.success;
        } catch (e) {
            console.error('Git stage failed', e);
            return false;
        }
    },

    async unstage(cwd, files) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.unstage(cwd, files);
            return res.success;
        } catch (e) {
            console.error('Git unstage failed', e);
            return false;
        }
    },

    async restore(cwd, files) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.restore(cwd, files);
            return res.success;
        } catch (e) {
            console.error('Git restore failed', e);
            return false;
        }
    },

    async commit(cwd, message) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.commit(cwd, message);
            return res.success;
        } catch (e) {
            console.error('Git commit failed', e);
            return false;
        }
    },

    async push(cwd) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.push(cwd);
            return res.success;
        } catch (e) {
            console.error('Git push failed', e);
            return false;
        }
    },

    async pull(cwd) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.pull(cwd);
            return res.success;
        } catch (e) {
            console.error('Git pull failed', e);
            return false;
        }
    },

    async branch(cwd) {
        if (!this.isAvailable()) return null;
        try {
            const res = await window.electronAPI.git.branch(cwd);
            return res.success ? res.branches : null;
        } catch (e) {
            console.error('Git branch failed', e);
            return null;
        }
    },

    async createBranch(cwd, name) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.createBranch(cwd, name);
            return res.success;
        } catch (e) {
            console.error('Git createBranch failed', e);
            return false;
        }
    },

    async deleteBranch(cwd, branch) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.deleteBranch(cwd, branch);
            return res.success;
        } catch (e) {
            console.error('Git deleteBranch failed', e);
            return false;
        }
    },

    async checkout(cwd, branch) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.checkout(cwd, branch);
            return res.success;
        } catch (e) {
            console.error('Git checkout failed', e);
            return false;
        }
    },

    async resolve(cwd, file, type) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.resolve(cwd, file, type);
            return res.success;
        } catch (e) {
            console.error('Git resolve failed', e);
            return false;
        }
    },

    async publishBranch(cwd, branch) {
        if (!this.isAvailable()) return false;
        if (typeof window.electronAPI.git.publishBranch !== 'function') {
            console.error('Git publishBranch is not available');
            return false;
        }
        try {
            const res = await window.electronAPI.git.publishBranch(cwd, branch);
            return res.success;
        } catch (e) {
            console.error('Git publishBranch failed', e);
            return false;
        }
    },

    async setUpstream(cwd, branch) {
        if (!this.isAvailable()) return false;
        if (typeof window.electronAPI.git.setUpstream !== 'function') {
            console.error('Git setUpstream is not available');
            return false;
        }
        try {
            const res = await window.electronAPI.git.setUpstream(cwd, branch);
            return res.success;
        } catch (e) {
            console.error('Git setUpstream failed', e);
            return false;
        }
    },

    async diff(cwd, file) {
        if (!this.isAvailable()) return null;
        try {
            const res = await window.electronAPI.git.diff(cwd, file);
            return res.success ? res.diff : null;
        } catch (e) {
            console.error('Git diff failed', e);
            return null;
        }
    },

    async init(cwd) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.init(cwd);
            return res.success;
        } catch (e) {
            console.error('Git init failed', e);
            return false;
        }
    },

    async getRemotes(cwd) {
        if (!this.isAvailable()) return [];
        try {
            const res = await window.electronAPI.git.getRemotes(cwd);
            return res.success ? res.remotes : [];
        } catch (e) {
            console.error('Git getRemotes failed', e);
            return [];
        }
    },

    async addRemote(cwd, name, url) {
        if (!this.isAvailable()) return false;
        try {
            const res = await window.electronAPI.git.addRemote(cwd, name, url);
            return res.success;
        } catch (e) {
            console.error('Git addRemote failed', e);
            return false;
        }
    },

    async log(cwd) {
        if (!this.isAvailable()) return [];
        try {
            const res = await window.electronAPI.git.log(cwd);
            return res.success ? res.log : [];
        } catch (e) {
            console.error('Git log failed', e);
            return [];
        }
    },

    async getCommitDetails(cwd, hash) {
        if (!this.isAvailable()) return [];
        try {
            const res = await window.electronAPI.git.getCommitDetails(cwd, hash);
            return res.success ? res.files : [];
        } catch (e) {
            console.error('Git getCommitDetails failed', e);
            return [];
        }
    },

    async getCommitStats(cwd, hash) {
        if (!this.isAvailable()) return null;
        try {
            const res = await window.electronAPI.git.getCommitStats(cwd, hash);
            return res.success ? res.stats : null;
        } catch (e) {
            console.error('Git getCommitStats failed', e);
            return null;
        }
    },

    async getCommitFileDiffs(cwd, hash) {
        if (!this.isAvailable()) return [];
        if (typeof window.electronAPI.git.getCommitFileDiffs !== 'function') {
            alert('Core component updated. Please restart the application to enable "Open All Diffs".');
            console.error('Missing git.getCommitFileDiffs in preload. Restart required.');
            return [];
        }
        try {
            const res = await window.electronAPI.git.getCommitFileDiffs(cwd, hash);
            return res.success ? res.files : [];
        } catch (e) {
            console.error('Git getCommitFileDiffs failed', e);
            return [];
        }
    },

    async getFileContent(cwd, hash, path) {
        if (!this.isAvailable()) return '';
        try {
            const res = await window.electronAPI.git.getFileContent(cwd, hash, path);
            return res.success ? res.content : '';
        } catch (e) {
            console.error('Git getFileContent failed', e);
            return '';
        }
    }
};
