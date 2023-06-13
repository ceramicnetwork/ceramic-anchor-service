export enum METRIC_NAMES {

  // *******************************************************************//
  // Anchor Service (counts)

  // Happy path
  ACCEPTED_REQUESTS = 'accepted_requests',
  ANCHOR_SUCCESS = 'anchor_success',

  // Errors and warnings
  ALREADY_ANCHORED_REQUESTS = 'already_anchored_requests',
  CONFLICTING_REQUESTS = 'conflicting_requests',
  ERROR_IPFS = 'error_ipfs',
  ERROR_MULTIQUERY = 'error_multiquery',
  ERROR_WHEN_ANCHORING = 'error_when_anchoring',
  FAILED_REQUESTS = 'failed_requests',
  FAILED_STREAM = 'failed_load_stream',
  FAILED_TIP = 'failed_load_tip',
  REANCHORED = 'reanchored',
  RETRY_EMIT_ANCHOR_EVENT = 'retry_emit_anchor_event',
  REVERT_TO_PENDING = 'revert_to_pending',
  UNPROCESSED_REQUESTS = 'unprocessed_requests',

  // Transaction repository
  MANY_ATTEMPTS_TO_ACQUIRE_MUTEX = 'many_attempts_to_acquire_mutex',

  // Request repository
  DB_SERIALIZATION_ERROR = 'db_serialization_error',

  // when a request is created, expired or completes
  REQUEST_CREATED = 'request_created',
  REQUEST_EXPIRED = 'request_expired',

  // retries that move to processing or failed
  RETRY_PROCESSING = 'retry_processing',
  RETRY_FAILED = 'retry_failed',

  // *******************************************************************//
  // Anchor Service (histograms)

  // request that moves from ready -> processing
  READY_PROCESSING_MS = "ready_processing_ms",

  // request that moves from created -> success
  CREATED_SUCCESS_MS = 'created_success_ms',

  // Anchor Controller
  ANCHOR_REQUESTS_BATCH_TIME = 'anchor_requests_batch_time',
  ANCHOR_REQUESTS_BATCH_FAILURE_TIME = 'anchor_requests_batch_failure_time',

  // *******************************************************************//
  // Ethereum Blockchain Service

  ETH_REQUEST_TOTAL = 'eth_request_total',
  ETH_REQUEST_ERROR_TOTAL = 'eth_request_error_total',

  // *******************************************************************//
  // Scheduler Service
  SCHEDULER_TASK_UNCAUGHT_ERROR = 'scheduler_task_uncaught_error',

  // *******************************************************************//
  // Ceramic Service
  PIN_SUCCEEDED = 'pin_succeeded',
  PIN_FAILED = 'pin_failed',

  // IPFS service
  IPFS_GET_SUCCEEDED = 'ipfs_get_succeeded',
  IPFS_GET_FAILED = 'ipfs_get_failed',

  // Request Controller
  ANCHOR_REQUESTED = 'anchor_requested',
  CAR_REQUESTED = 'car_requested',
  LEGACY_REQUESTED = 'legacy_requested',
  REQUEST_INVALID = 'request_invalid',
  REQUEST_NOT_CREATED = 'request_not_created'
}
