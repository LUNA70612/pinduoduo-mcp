// Pinduoduo adapter. Safety and browser logic are shared by CLI and MCP.
import {cli,Strategy} from '@jackwener/opencli/registry';
import adapter from './_adapter.cjs';
cli({...adapter.definition('read_cart'),strategy:Strategy.COOKIE});
