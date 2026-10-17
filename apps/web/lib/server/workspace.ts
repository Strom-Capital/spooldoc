import 'server-only';

import { openWorkspace, type Workspace } from '@spooldoc/core';
import { getConfig } from './config';

/** The workspace folder from SPOOLDOC_WORKSPACE (default: `workspace/` at the repository root). */
export function getWorkspace(): Workspace {
  return openWorkspace(getConfig().workspace);
}

/** Definition and template type names: lowercase letters, digits and dashes. */
export const TYPE_NAME = /^[a-z0-9-]+$/;
