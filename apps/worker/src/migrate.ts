/**
 * Database migration entrypoint, run by the `migrate` compose service on every
 * deploy before new web/worker containers start. Implemented in the data-model step.
 */
import { getLogger } from '@nm/core';

getLogger({ service: 'migrate' }).info('no migrations defined yet');
