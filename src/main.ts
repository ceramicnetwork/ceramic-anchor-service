import CeramicAnchorApp from './app';
import { logger } from "./logger";

import { config } from 'node-config-ts';
import { container } from 'tsyringe';

const app = new CeramicAnchorApp(container, config);
app.start()
  .catch((e) => {
    logger.err(e);
    process.exit(1);
  });
