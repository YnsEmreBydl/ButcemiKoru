import type { StartPeriodCommandV3 } from '../../src/data/budget/v3-contracts';
import type { PeriodPort } from '../../src/features/periods/contracts';
import { scopeOf } from '../../src/features/periods/contracts';
import { createFixturePeriodPort } from '../../src/features/periods/fixture-port';
import { createPeriodFormController } from '../../src/features/periods/form-controller';

export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw Error('Uninitialized gate'); };
  let reject: (error: unknown) => void = () => { throw Error('Uninitialized gate'); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
export async function fixture(overrides: Partial<PeriodPort> = {}) {
  const fake = createFixturePeriodPort({ wait: async () => {} });
  const commands: StartPeriodCommandV3[] = []; let idRequests = 0;
  const port: PeriodPort = { ...fake.port,
    newPublicId: async () => { idRequests++; return fake.port.newPublicId(); },
    startPeriod: async command => { commands.push(command); return fake.port.startPeriod(command); }, ...overrides };
  const source = await port.loadActivePeriod(fake.bookId, fake.now()); if (!source) throw Error('fixture');
  const controller = createPeriodFormController(port, scopeOf(source), fake.now); await controller.load();
  return { ...fake, port, source, controller, commands, idRequests: () => idRequests };
}
export function fill(controller: ReturnType<typeof createPeriodFormController>, withInvoice = true) {
  controller.change('balance', '3.000,25'); controller.change('payday', '04.12.2026'); controller.change('savings', '500,00');
  if (withInvoice) controller.changePayment('rent', { selected: true, dueDate: '28.11.2026' });
  controller.preview(); controller.confirm('balanceConfirmed', true); controller.confirm('archiveConfirmed', true);
}
