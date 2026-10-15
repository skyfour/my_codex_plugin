export const DEFAULT_LIMITS={fileMiB:5,totalMiB:50};
export function validateLimits(value){if(!value||!Number.isInteger(value.fileMiB)||value.fileMiB<1||value.fileMiB>20||!Number.isInteger(value.totalMiB)||value.totalMiB<10||value.totalMiB>200||value.totalMiB<value.fileMiB*2)throw Error('单文件上限为 1–20 MiB，快照上限为 10–200 MiB，且至少为单文件上限的两倍');return {fileMiB:value.fileMiB,totalMiB:value.totalMiB};}
export class SizeLimitError extends Error{
 constructor({path,bytes,limitMiB,total=false}){super(total?`审查快照超过 ${limitMiB} MiB，请在设置中调整上限或缩小范围`:`文件超过 ${limitMiB} MiB：${path}。可在设置中调整预览上限；Stage / Unstage 不受此限制`);this.code=total?'SNAPSHOT_LIMIT':'FILE_LIMIT';this.path=path;this.bytes=bytes;this.limitMiB=limitMiB;}
}
