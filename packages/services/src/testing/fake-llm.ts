import type { CompletionRequest, CompletionResult, LlmProvider } from '../ai/providers';

export type FakeHandler = (request: CompletionRequest, call: number) => string | Error;

/** Scripted provider for tests: every call is recorded, answers come from `handler`. */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly calls: CompletionRequest[] = [];

  constructor(
    private readonly handler: FakeHandler,
    private readonly usage = { inputTokens: 2_000, outputTokens: 800, cacheReadTokens: 0 },
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const answer = this.handler(request, this.calls.length);
    if (answer instanceof Error) throw answer;
    return {
      text: answer,
      usage: this.usage,
      provider: this.name,
      model: this.model,
      prices: { input: 1, output: 5, cacheRead: 0.1 },
    };
  }
}

export function rewriteAnswer(
  overrides: Partial<{ title: string; tldr: string; body: string; topics: string[] }> = {},
) {
  return JSON.stringify({
    title: 'Депутатите одобриха нови правила за местните данъци',
    tldr: 'Парламентът прие на първо четене промени, които дават на общините повече свобода при данъците.',
    body: [
      'Депутатите подкрепиха на първо гласуване поправки в закона, който урежда местните данъци и такси.',
      'Авторите на текстовете твърдят, че общините ще могат по-точно да прогнозират постъпленията си.',
      'Опозиционните партии критикуваха липсата на широк обществен дебат преди внасянето на проекта.',
      'По оценка на финансовото ведомство бюджетът няма да бъде засегнат, защото събираемостта ще се подобри.',
    ].join('\n\n'),
    topics: ['politics', 'business'],
    ...overrides,
  });
}

export function translationAnswer() {
  return JSON.stringify({
    title: 'MPs approve new rules for local taxes',
    tldr: 'Parliament passed changes at first reading that give municipalities more freedom over local taxes.',
    body: [
      'Members of parliament backed amendments to the law governing local taxes and fees at first reading.',
      'The sponsors say municipalities will be able to forecast their revenue more accurately.',
      'Opposition parties criticised the lack of a broad public debate before the bill was tabled.',
      'The finance ministry expects no effect on the budget because collection rates should improve.',
    ].join('\n\n'),
  });
}
