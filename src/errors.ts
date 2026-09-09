import type { AIErrorCode, AIErrorInfo } from './types.js';

export class IrisAIError extends Error implements AIErrorInfo {
  readonly code: AIErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(code: AIErrorCode, message: string, status: number | null = null, retryable = false) {
    super(message);
    this.name = 'IrisAIError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
  toJSON(): AIErrorInfo {
    return { code: this.code, message: this.message, status: this.status, retryable: this.retryable };
  }
}
