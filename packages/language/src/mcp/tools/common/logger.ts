/**
 * Centralized Logger Service
 * 
 * Provides consistent logging across the MCP server with levels: debug, info, warn, error.
 * Can be easily swapped for a proper logging library (winston, pino, etc.).
 */

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

export interface Logger {
    debug(message: string, context?: Record<string, any>): void;
    info(message: string, context?: Record<string, any>): void;
    warn(message: string, context?: Record<string, any>): void;
    error(message: string, error?: Error | unknown, context?: Record<string, any>): void;
}

/**
 * Default console-based logger implementation
 */
class ConsoleLogger implements Logger {
    constructor(private prefix: string = '[OML-MCP]', private minLevel: LogLevel = LogLevel.DEBUG) {}

    private format(level: LogLevel, message: string, context?: Record<string, any>): string {
        const timestamp = new Date().toISOString();
        const contextStr = context ? ` ${JSON.stringify(context)}` : '';
        return `${timestamp} ${this.prefix} [${level}] ${message}${contextStr}`;
    }

    debug(message: string, context?: Record<string, any>): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.error(this.format(LogLevel.DEBUG, message, context));
        }
    }

    info(message: string, context?: Record<string, any>): void {
        if (this.shouldLog(LogLevel.INFO)) {
            console.error(this.format(LogLevel.INFO, message, context));
        }
    }

    warn(message: string, context?: Record<string, any>): void {
        if (this.shouldLog(LogLevel.WARN)) {
            console.error(this.format(LogLevel.WARN, message, context));
        }
    }

    error(message: string, error?: Error | unknown, context?: Record<string, any>): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            const errorStr = error instanceof Error ? `\n${error.stack}` : String(error);
            console.error(this.format(LogLevel.ERROR, message, context) + errorStr);
        }
    }

    private shouldLog(level: LogLevel): boolean {
        const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
        return levels.indexOf(level) >= levels.indexOf(this.minLevel);
    }
}

/**
 * Parse log level from environment variable
 */
function getDefaultLogLevel(): LogLevel {
    const envLevel = process.env.OML_LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LogLevel) {
        return LogLevel[envLevel as keyof typeof LogLevel];
    }
    return LogLevel.DEBUG;
}

/**
 * Global logger instance - can be configured at startup
 * Respects OML_LOG_LEVEL environment variable (DEBUG, INFO, WARN, ERROR)
 */
let globalLogger: Logger = new ConsoleLogger('[OML-MCP]', getDefaultLogLevel());

/**
 * Get the global logger instance
 */
export function getLogger(module?: string): Logger {
    if (module) {
        return new ConsoleLogger(`[OML-MCP:${module}]`);
    }
    return globalLogger;
}

/**
 * Configure the global logger (e.g., set log level)
 */
export function configureLogger(logger: Logger): void {
    globalLogger = logger;
}

/**
 * Create a logger for a specific module
 */
export function createLogger(moduleName: string, minLevel: LogLevel = LogLevel.DEBUG): Logger {
    return new ConsoleLogger(`[OML-MCP:${moduleName}]`, minLevel);
}
