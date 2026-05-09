export class Reporter {
  async dispatch(data: unknown): Promise<boolean> {
    // TODO: 接口就绪后替换为实际 fetch POST
    // 预留接口格式:
    // const res = await fetch(this.config.endpoint, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(data),
    // });
    // return res.ok;

    console.log('[BehaviorTrack] dispatch:', data);
    return true;
  }
}
