"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Monitor = void 0;
class Monitor {
    static errorCount = 0;
    static totalCount = 0;
    static threshold = 0.05; // 5%
    static recordExecution(success) {
        this.totalCount++;
        if (!success) {
            this.errorCount++;
        }
        this.checkAlarm();
    }
    static checkAlarm() {
        if (this.totalCount < 10)
            return; // Warm up
        const rate = this.errorCount / this.totalCount;
        if (rate > this.threshold) {
            console.warn(`[Monitor] ALARM: Error rate ${rate.toFixed(2)} exceeds threshold ${this.threshold}`);
            // In real system, send email/slack
        }
    }
    static getStats() {
        return {
            total: this.totalCount,
            errors: this.errorCount,
            rate: this.totalCount > 0 ? this.errorCount / this.totalCount : 0
        };
    }
}
exports.Monitor = Monitor;
