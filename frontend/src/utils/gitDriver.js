export const GitDriver = {
    isAvailable: () => typeof window !== 'undefined' && !!window.electronAPI?.git,

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
