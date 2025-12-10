
export class Monitor {
    private static errorCount = 0;
    private static totalCount = 0;
    private static threshold = 0.05; // 5%

    static recordExecution(success: boolean) {
        this.totalCount++;
        if (!success) {
            this.errorCount++;
        }
        this.checkAlarm();
    }

    private static checkAlarm() {
        if (this.totalCount < 10) return; // Warm up
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
