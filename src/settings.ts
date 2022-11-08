export enum METRIC_NAMES {

  ANCHOR_REQUESTED = 'anchor_requested',
  ANCHOR_REQUESTS_BATCH_TIME = 'anchor_requests_batch_time',
  ANCHOR_REQUESTS_BATCH_FAILURE_TIME = 'anchor_requests_batch_failure_time',

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

  // request that moves from ready -> processing
  READY_PROCESSING = 'ready_processing',

  // when a request is created, expired or completes
  REQUEST_CREATED = 'request_created',
  REQUEST_EXPIRED = 'request_expired',
  REQUEST_COMPLETED = 'request_completed',

  // retries that move to processing or failed
  RETRY_PROCESSING = 'retry_processing',
  RETRY_FAILED = 'retry_failed',

  TIME_ANCHOR_COMMITS_MS = 'time_anchor_commits_ms',
  TIME_TREE_COMMIT_MS = 'time_tree_commit_ms',

  ACCEPTED_REQUESTS = 'accepted_requests',
  ALREADY_ANCHORED_REQUESTS = 'already_anchored_requests',
  CONFLICTING_REQUESTS = 'conflicting_requests',
  FAILED_REQUESTS = 'failed_requests',
  UNPROCESSED_REQUESTS = 'unprocessed_requests',

  SCHEDULER_TASK_UNCAUGHT_ERROR = 'scheduler_task_uncaught_error',
  MANY_ATTEMPTS_TO_ACQUIRE_MUTEX = 'many_attempts_to_acquire_mutex',
}
