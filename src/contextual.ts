import Context from './context';

/**
 * Implement in order to get context
 */
export default interface Contextual {
  setContext(context: Context): void;
}
