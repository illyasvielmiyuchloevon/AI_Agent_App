"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseToolImplementation = void 0;
class BaseToolImplementation {
    toOpenAISchema() {
        return {
            type: "function",
            function: {
                name: this.name,
                description: this.description,
                parameters: this.input_schema
            }
        };
    }
}
exports.BaseToolImplementation = BaseToolImplementation;
