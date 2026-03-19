import { bitableBuiltinToolName, bitableBuiltinTools } from './bitable/builtin';
import { docxBuiltinToolName, docxBuiltinTools } from './docx/builtin';
import { driveBuiltinToolName, driveBuiltinTools } from './drive/builtin';
import { imBuiltinToolName, imBuiltinTools } from './im/buildin';

export const BuiltinTools = [...bitableBuiltinTools, ...docxBuiltinTools, ...driveBuiltinTools, ...imBuiltinTools];

export type BuiltinToolName = bitableBuiltinToolName | docxBuiltinToolName | driveBuiltinToolName | imBuiltinToolName;
