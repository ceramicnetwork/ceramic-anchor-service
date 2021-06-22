import CeramicAnchorApp from './app';
import { logger } from "./logger";

import { container } from 'tsyringe';

const app = new CeramicAnchorApp(container);
app.start()
  .catch((e) => {
    logger.err(e);
    process.exit(1);
  });
