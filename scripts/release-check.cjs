'use strict';
// Read-only report: never logs in, navigates, rewrites evidence or creates a package.
const path=require('node:path');
const {inspectReleaseGate}=require('../tools/release-gate.cjs');
if(require.main===module){const report=inspectReleaseGate(path.resolve(__dirname,'..'));process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.release_allowed)process.exitCode=1;}
