export enum METRIC_NAMES {
  ANCHOR_SUCCESS = 'anchor_success',
  ANCHOR_TIMEOUT = 'anchor_timeout',
  ERROR_ETH = 'error_eth',
  RETRY_EMIT_ANCHOR_EVENT = 'retry_emit_anchor_event',
  REVERT_TO_PENDING = 'revert_to_pending',
  DB_SERIALIZATION_ERROR = 'db_serialization_error',
  RETRY_PROCESSING = 'retry_processing',
  RETRY_FAILED = 'retry_failed',
  RETRY_EXPIRING = 'retry_expiring',
  UNPROCESSED_REQUESTS = 'unprocessed_requests',
  SCHEDULER_TASK_UNCAUGHT_ERROR = 'scheduler_task_uncaught_error',
  MANY_ATTEMPTS_TO_ACQUIRE_MUTEX = 'many_attempts_to_acquire_mutex',
}
