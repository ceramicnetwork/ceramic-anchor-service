export enum METRIC_NAMES {
  ANCHOR_SUCCESS = 'anchor_success',
  ANCHOR_TIMEOUT = 'anchor_timeout',
  ERROR_ETH = 'error_eth',
  ERROR_IPFS = 'error_ipfs',
  ERROR_MULTIQUERY = 'error_multiquery',

  FAILED_TIP = 'failed_load_tip',
  FAILED_STREAM = 'failed_load_stream',

  RETRY_EMIT_ANCHOR_EVENT = 'retry_emit_anchor_event',
  REVERT_TO_PENDING = 'revert_to_pending',

  DB_SERIALIZATION_ERROR = 'db_serialization_error',

  PIN_REQUESTED = 'pin_requested',
  PIN_SUCCEEDED = 'pin_succeeded',
  PIN_FAILED = 'pin_failed',

  RETRY_PROCESSING = 'retry_processing',
  RETRY_FAILED = 'retry_failed',
  RETRY_EXPIRING = 'retry_expiring',

  TIME_ANCHOR_COMMITS_MS = 'time_anchor_commits_ms',
  TIME_TREE_COMMIT_MS = 'time_tree_commit_ms',

  ACCEPTED_REQUESTS = 'accepted_requests',
  ALREADY_ANCHORED_REQUESTS = 'already_anchored_requests',
  CONFLICTING_REQUESTS = 'conflicting_requests',
  FAILED_REQUESTS = 'failed_requests',
  UNPROCESSED_REQUESTS = 'unprocessed_requests',
  PENDING_REQUESTS = 'pending_requests',

  SCHEDULER_TASK_UNCAUGHT_ERROR = 'scheduler_task_uncaught_error',
  MANY_ATTEMPTS_TO_ACQUIRE_MUTEX = 'many_attempts_to_acquire_mutex',
}
