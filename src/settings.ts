export enum METRIC_NAMES {
  // *******************************************************************//
  // All metrics are counts unless noted otherwise
  // counts are running totals and should be used with rate() or increase()

  // Anchor Service (counts)

  // NOTE that anchor service worker metrics are not currently showing up in dev cas

  // Happy path
  ACCEPTED_REQUESTS = 'accepted_requests', // Anchor service: request candidates accepted
  ANCHOR_SUCCESS = 'anchor_success', // Anchor service: requests successfully anchored

  // Anchor Service Errors and warnings
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
  NO_MERKLE_CAR_FOR_ANCHOR = 'no_merkle_car_for_anchor',
  NO_ANCHOR_FOR_REQUEST = 'no_anchor_for_request',
  MERKLE_CAR_STORAGE_FAILURE_IPFS = 'merkle_car_storage_failure_ipfs',
  MERKLE_CAR_STORAGE_FAILURE_S3 = 'merkle_car_storage_failure_s3',
  WITNESS_CAR_STORAGE_FAILURE = 'witness_car_storage_failure',
  ANCHOR_TAKING_TOO_LONG = 'anchor_taking_too_long',

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
  READY_PROCESSING_MS = 'ready_processing_ms',

  // request that moves from created -> success
  CREATED_SUCCESS_MS = 'created_success_ms',

  // Anchor Controller
  ANCHOR_REQUESTS_BATCH_TIME = 'anchor_requests_batch_time',
  ANCHOR_REQUESTS_BATCH_FAILURE_TIME = 'anchor_requests_batch_failure_time',

  // *******************************************************************//
  // Request Service
  WRITE_TOTAL_TSDB = 'write_total_tsdb', // note _tsdb implies handles high cardinality
  REPLICA_DB_REQUEST_NOT_FOUND = 'replica_db_request_not_found',
  // DO NOT change TSDB as it is used downstream

  MERKLE_CAR_CACHE_HIT = 'merkle_car_cache_hit',
  MERKLE_CAR_CACHE_MISS = 'merkle_car_cache_miss',
  WITNESS_CAR_CACHE_HIT = 'witness_car_cache_hit',
  WITNESS_CAR_CACHE_MISS = 'witness_car_cache_miss',
  PUBLISH_TO_QUEUE = 'publish_to_queue',
  UPDATED_STORED_REQUEST = 'updated_stored_request',

  // *******************************************************************//
  // Ceramic Service
  PIN_SUCCEEDED = 'pin_succeeded',
  PIN_FAILED = 'pin_failed',

  // IPFS service
  IPFS_GET_SUCCEEDED = 'ipfs_get_succeeded',
  IPFS_GET_FAILED = 'ipfs_get_failed',

  // Request Controller
  CTRL_NEW_ANCHOR_REQUEST = 'ctrl_new_anchor_request',
  CTRL_FOUND_EXISTING_REQUEST = 'ctrl_found_existing_request',
  CTRL_CAR_REQUESTED = 'ctrl_car_requested',
  CTRL_JSON_REQUESTED = 'ctrl_json_requested',
  CTRL_INVALID_REQUEST = 'ctrl_invalid_request',
  CTRL_ERROR_CREATING_REQUEST = 'ctrl_error_creating_request',
  CTRL_REQUEST_NOT_FOUND = 'ctrl_request_not_found',
  CTRL_REQUEST_FOUND = 'ctrl_request_found',

  // Auth
  AUTH_ALLOWED = 'auth_allowed',
  AUTH_DISALLOWED = 'auth_disallowed',
}
