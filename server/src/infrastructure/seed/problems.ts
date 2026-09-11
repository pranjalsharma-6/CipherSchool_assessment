import { Problem } from '../../domain/problem/Problem.js';
import { Rubric } from '../../domain/problem/Rubric.js';
import { ProblemId } from '../../domain/shared/ids.js';

/**
 * The seeded problem catalogue.
 *
 * Problems are data, not code: the signals, concepts, pitfalls and rubric
 * weights below are the only thing that has to be written to add a problem, and
 * the deterministic checker picks all of it up with no new classes. Authoring a
 * problem is therefore a content task, which is what makes the catalogue
 * something a mentor could grow without an engineer.
 */
export function seedProblems(): Problem[] {
  return [parkingLot(), vendingMachine(), elevator(), expenseSplitter()];
}

function parkingLot(): Problem {
  return new Problem({
    id: ProblemId('prob_parking_lot'),
    slug: 'parking-lot',
    title: 'Parking Lot',
    difficulty: 'easy',
    estimatedMinutes: 40,
    summary:
      'The classic first LLD problem. Easy to start, and a good test of whether you can model pricing and allocation as things rather than as if-statements.',
    statement: `Design the object model for a multi-floor parking lot.

Vehicles arrive at an entrance, are assigned a suitable parking spot, and are issued a ticket. On the way out they pay based on how long they stayed and the kind of vehicle they brought, and the spot is released for the next vehicle.

The lot has several floors. Spots come in sizes (motorcycle, compact, large) and a vehicle may only occupy a spot that fits it. Some spots are reserved for electric vehicles and have a charger attached.

Model the classes, their responsibilities, and the relationships between them. You are not being asked for a working implementation, a database schema, or an API: just the design.`,
    constraints: [
      'A single physical lot; you do not need to model a chain of lots.',
      'Payment is taken at exit. You do not need to integrate a real payment provider: model the boundary.',
      'Assume up to a few thousand spots, so an in-memory index of free spots is reasonable.',
    ],
    requirements: [
      {
        id: 'park',
        kind: 'stated',
        text: 'A vehicle can be parked and receives a ticket that identifies its spot and entry time.',
        signals: ['ticket', 'park', 'entry time', 'issue ticket', 'parkingticket'],
      },
      {
        id: 'spot-fit',
        kind: 'stated',
        text: 'A vehicle is only assigned a spot that its size fits.',
        signals: ['size', 'spottype', 'spot type', 'fits', 'compact', 'motorcycle', 'large', 'vehiclesize'],
      },
      {
        id: 'floors',
        kind: 'stated',
        text: 'Spots are organised across multiple floors.',
        signals: ['floor', 'level', 'parkingfloor'],
      },
      {
        id: 'pricing',
        kind: 'stated',
        text: 'The exit fee depends on duration and vehicle type.',
        signals: ['fee', 'price', 'pricing', 'rate', 'charge', 'billing', 'cost', 'tariff'],
      },
      {
        id: 'release',
        kind: 'stated',
        text: 'Leaving frees the spot for reuse.',
        signals: ['release', 'free', 'vacate', 'unpark', 'available', 'exit'],
      },
      {
        id: 'ev',
        kind: 'stated',
        text: 'Electric vehicles can be assigned a spot with a charger.',
        signals: ['electric', 'ev', 'charger', 'charging'],
      },
      {
        id: 'full',
        kind: 'implied',
        text: 'What happens when no suitable spot is free?',
        signals: ['full', 'no spot', 'unavailable', 'reject', 'lotfull', 'sold out', 'empty'],
      },
      {
        id: 'contention',
        kind: 'implied',
        text: 'Two vehicles can reach the last free spot at the same moment.',
        signals: ['concurrent', 'lock', 'atomic', 'synchronized', 'race', 'thread', 'reserve'],
      },
      {
        id: 'lost-ticket',
        kind: 'implied',
        text: 'A ticket can be lost, and a vehicle can still need to exit.',
        signals: ['lost ticket', 'lost', 'plate', 'license', 'registration'],
      },
    ],
    expectedConcepts: [
      {
        name: 'Pricing policy',
        aliases: ['pricingstrategy', 'feecalculator', 'ratecard', 'pricingpolicy', 'billingstrategy', 'tariff', 'pricing'],
        why: 'Rates change constantly: weekends, EV discounts, the first 15 minutes free. If the calculation lives inside Ticket or Vehicle, every rate change edits the core domain.',
      },
      {
        name: 'Spot allocation',
        aliases: ['allocationstrategy', 'spotassigner', 'parkingstrategy', 'allocator', 'assignmentstrategy', 'findspot', 'nearest'],
        why: 'Nearest-to-entrance, floor-fill and EV-first are different policies over the same data, and lots switch between them.',
      },
      {
        name: 'Ticket',
        aliases: ['ticket', 'parkingticket', 'receipt', 'token'],
        why: 'The record that ties a vehicle to a spot and a start time: the thing pricing and exit both read.',
      },
      {
        name: 'Spot',
        aliases: ['spot', 'slot', 'parkingspot', 'space', 'bay'],
        why: 'The allocatable resource, with its own size and occupancy state.',
      },
      {
        name: 'Payment',
        aliases: ['payment', 'paymentprocessor', 'transaction', 'invoice', 'paymentgateway'],
        why: 'A boundary to something outside the lot; keeping it behind an interface is what makes the domain testable.',
      },
    ],
    pitfalls: [
      {
        id: 'boolean-spot',
        summary: 'A parking spot modelled as a boolean',
        triggers: ['isoccupied: boolean', 'boolean[]', 'occupied flag', 'boolean occupied'],
        guidance:
          'A free/taken flag cannot answer "which vehicle is here", "since when", or "is this spot out of service". Spot occupancy usually wants to be a reference to the current Ticket, or its own small state type.',
      },
      {
        id: 'enum-switch-pricing',
        summary: 'Pricing decided by a switch over vehicle type',
        triggers: ['switch (vehicletype', 'if vehicletype ==', 'switch(type', 'if (type =='],
        guidance:
          'Every new rate (EV discount, night tariff, monthly pass) reopens that switch. A PricingStrategy chosen per ticket keeps the change to a new class.',
      },
      {
        id: 'god-lot',
        summary: 'One ParkingLot class doing allocation, pricing and payment',
        triggers: ['parkinglot.calculatefee', 'lot.processpayment', 'parkinglot.pay'],
        guidance:
          'ParkingLot is a good aggregate root but a poor place to put every rule. Let it coordinate: hold the floors, delegate allocation and pricing to collaborators.',
      },
    ],
    discussionPrompts: [
      'The lot wants to charge a flat overnight rate after 8pm. How many classes change?',
      'Two cars reach the last compact spot at the same instant. Where exactly is the contention, and what stops both from getting a ticket?',
      'A customer loses their ticket. Which class knows what to charge them?',
    ],
    tags: ['allocation', 'pricing', 'concurrency', 'state'],
    rubric: Rubric.of({
      requirement_coverage: 1.2,
      abstraction_quality: 1.3,
      relationships: 1,
      extensibility: 1.2,
      edge_cases: 1,
      tradeoff_reasoning: 0.9,
    }),
  });
}

function vendingMachine(): Problem {
  return new Problem({
    id: ProblemId('prob_vending_machine'),
    slug: 'vending-machine',
    title: 'Vending Machine',
    difficulty: 'easy',
    estimatedMinutes: 35,
    summary:
      'A small problem that is really about state. The interesting question is whether the machine is one object with a mode flag, or a family of states.',
    statement: `Design the object model for a vending machine.

A customer selects a product, inserts coins or notes one at a time, and the machine dispenses the product along with any change owed. The customer can cancel at any point before dispensing and get their money back.

The machine tracks its inventory per slot and the coins it holds, since it can only give change it actually has.

Model the classes, their responsibilities, and how the machine moves between its states.`,
    constraints: [
      'Physical coins and notes only, no card reader.',
      'A single machine; you do not need a fleet or a restocking service.',
      'Change is made from the coins currently in the machine.',
    ],
    requirements: [
      {
        id: 'select',
        kind: 'stated',
        text: 'A customer can select a product by its slot code.',
        signals: ['select', 'slot', 'code', 'choose', 'product'],
      },
      {
        id: 'insert',
        kind: 'stated',
        text: 'Money is inserted incrementally and the machine tracks the running balance.',
        signals: ['insert', 'coin', 'note', 'balance', 'amount', 'deposit', 'payment'],
      },
      {
        id: 'dispense',
        kind: 'stated',
        text: 'The product is dispensed once enough money has been inserted.',
        signals: ['dispense', 'deliver', 'release', 'vend'],
      },
      {
        id: 'change',
        kind: 'stated',
        text: 'Change is returned from the coins the machine holds.',
        signals: ['change', 'refund', 'coinreturn', 'denomination', 'coininventory'],
      },
      {
        id: 'cancel',
        kind: 'stated',
        text: 'The customer can cancel and get their money back before dispensing.',
        signals: ['cancel', 'abort', 'refund', 'return money'],
      },
      {
        id: 'inventory',
        kind: 'stated',
        text: 'The machine knows its stock per slot.',
        signals: ['inventory', 'stock', 'quantity', 'count', 'sold out'],
      },
      {
        id: 'no-change',
        kind: 'implied',
        text: 'The machine may not hold the coins needed to make exact change.',
        signals: ['exact change', 'cannot make change', 'insufficient change', 'no change'],
      },
      {
        id: 'out-of-stock',
        kind: 'implied',
        text: 'A selected slot can be empty.',
        signals: ['out of stock', 'sold out', 'empty', 'unavailable'],
      },
    ],
    expectedConcepts: [
      {
        name: 'Machine state',
        aliases: ['state', 'vendingstate', 'idlestate', 'machinestate', 'statemachine', 'hasmoneystate', 'dispensingstate'],
        why: 'What "insert coin" means depends entirely on where the machine is. Modelling that explicitly is the whole point of this problem.',
      },
      {
        name: 'Coin inventory',
        aliases: ['coininventory', 'cashbox', 'coinstore', 'changemaker', 'denomination', 'coin'],
        why: 'Change is constrained by what is physically in the machine, which is a different concern from product stock.',
      },
      {
        name: 'Product inventory',
        aliases: ['inventory', 'stock', 'slot', 'rack', 'productslot'],
        why: 'Slots hold a product and a count; selection has to consult it before taking any money.',
      },
      {
        name: 'Change strategy',
        aliases: ['changestrategy', 'changemaker', 'coinchanger', 'greedy', 'makechange'],
        why: 'Choosing which coins to return is an algorithm that can be swapped: greedy works for most currencies but not all.',
      },
    ],
    pitfalls: [
      {
        id: 'boolean-state',
        summary: 'Machine state tracked with boolean flags',
        triggers: ['ispaid', 'isdispensing', 'hasmoney: boolean', 'boolean isselected'],
        guidance:
          'Three booleans describe eight states, several of them nonsense (paid and idle at once). One state object, or at minimum one enum with explicit transitions, makes the impossible ones unrepresentable.',
      },
      {
        id: 'change-in-machine',
        summary: 'Change calculation living directly on the machine class',
        triggers: ['vendingmachine.calculatechange', 'machine.makechange'],
        guidance:
          'Making change is a coin-selection algorithm over the cash box. Its own collaborator keeps it testable, and lets you swap greedy for exact-solving without touching the state machine.',
      },
    ],
    discussionPrompts: [
      'Insert coin, then cancel, then insert coin again. Which object holds the balance, and who resets it?',
      'The machine has the product but cannot make exact change. What does select() return, and at what point is the customer told?',
      'What has to change to accept a card as well as coins?',
    ],
    tags: ['state', 'inventory'],
    rubric: Rubric.of({
      requirement_coverage: 1,
      abstraction_quality: 1.3,
      relationships: 0.9,
      extensibility: 1.1,
      edge_cases: 1.3,
      tradeoff_reasoning: 0.9,
    }),
  });
}

function elevator(): Problem {
  return new Problem({
    id: ProblemId('prob_elevator'),
    slug: 'elevator-system',
    title: 'Elevator System',
    difficulty: 'hard',
    estimatedMinutes: 55,
    summary:
      'Where most candidates lose the thread. The hard part is not the lift, it is separating the request, the scheduler and the car.',
    statement: `Design the object model for the elevator system of an office building.

The building has several floors and several elevator cars. A person on a floor presses up or down; a person inside a car presses a destination floor. The system decides which car serves which request and in what order, then the cars move, stop and open their doors.

Cars can be taken out of service for maintenance, and some are restricted to certain floors.

Model the classes, their responsibilities, and the relationships between them. Be explicit about who decides which car goes where.`,
    constraints: [
      'A single building; you do not need to coordinate across buildings.',
      'Assume the mechanical layer (motor, doors) is available behind a simple interface.',
      'Scheduling can be a reasonable heuristic, you are not being asked for an optimal algorithm.',
    ],
    requirements: [
      {
        id: 'hall-call',
        kind: 'stated',
        text: 'A person on a floor can request a car by direction.',
        signals: ['hall call', 'hallcall', 'external request', 'up', 'down', 'direction', 'call'],
      },
      {
        id: 'car-call',
        kind: 'stated',
        text: 'A person inside a car can request a destination floor.',
        signals: ['car call', 'carcall', 'internal request', 'destination', 'floor button'],
      },
      {
        id: 'dispatch',
        kind: 'stated',
        text: 'The system chooses which car serves each request.',
        signals: ['dispatch', 'scheduler', 'assign', 'select car', 'controller', 'allocate'],
      },
      {
        id: 'movement',
        kind: 'stated',
        text: 'A car moves between floors, stops, and opens its doors.',
        signals: ['move', 'stop', 'door', 'travel', 'position', 'currentfloor'],
      },
      {
        id: 'ordering',
        kind: 'stated',
        text: 'A car serves its pending stops in a sensible order rather than strictly first-come.',
        signals: ['queue', 'order', 'sort', 'sweep', 'scan', 'pending', 'stops', 'look'],
      },
      {
        id: 'maintenance',
        kind: 'stated',
        text: 'A car can be out of service or restricted to certain floors.',
        signals: ['maintenance', 'out of service', 'disabled', 'restricted', 'servicemode', 'available'],
      },
      {
        id: 'no-car',
        kind: 'implied',
        text: 'Every car may be unavailable when a request arrives.',
        signals: ['no car', 'unavailable', 'queue request', 'pending', 'reject', 'wait'],
      },
      {
        id: 'reassign',
        kind: 'implied',
        text: 'A car assigned to a request can go out of service before serving it.',
        signals: ['reassign', 'reschedule', 'requeue', 'failover', 'reassignment'],
      },
      {
        id: 'concurrency',
        kind: 'implied',
        text: 'Requests arrive concurrently from many floors.',
        signals: ['concurrent', 'thread', 'lock', 'queue', 'atomic', 'synchronized', 'event'],
      },
    ],
    expectedConcepts: [
      {
        name: 'Request',
        aliases: ['request', 'call', 'hallcall', 'carcall', 'elevatorrequest'],
        why: 'A request has an origin, a direction and a lifecycle of its own, it is created before any car is chosen, and outlives a car going out of service.',
      },
      {
        name: 'Dispatch strategy',
        aliases: ['dispatchstrategy', 'scheduler', 'schedulingstrategy', 'dispatcher', 'selectionstrategy', 'nearestcar', 'scan'],
        why: 'Which car serves a call is the decision the whole system turns on, and buildings tune it: nearest car, least busy, zoned by floor band.',
      },
      {
        name: 'Elevator car',
        aliases: ['car', 'elevatorcar', 'elevator', 'cabin', 'lift'],
        why: 'The moving resource: it owns its position, direction, door state and pending stops, and nothing else should be reaching in to set them.',
      },
      {
        name: 'Car state',
        aliases: ['state', 'idle', 'moving', 'doorsopen', 'direction', 'elevatorstate', 'motion'],
        why: 'Whether a car can accept a stop depends on where it is and which way it is going; an explicit state keeps that from becoming a chain of ifs.',
      },
      {
        name: 'Stop queue',
        aliases: ['stopqueue', 'queue', 'pendingstops', 'destinations', 'itinerary', 'stops'],
        why: 'The ordered work of one car, separate from the building-wide decision of who serves what.',
      },
    ],
    pitfalls: [
      {
        id: 'single-queue',
        summary: 'One shared queue of requests with no per-car itinerary',
        triggers: ['global queue', 'single queue', 'requestqueue for all', 'shared queue'],
        guidance:
          'Two queues are doing two jobs: the building decides which car takes a call, the car decides the order of its own stops. Collapsing them makes the ordering rule impossible to express.',
      },
      {
        id: 'car-decides',
        summary: 'The car choosing which requests to accept',
        triggers: ['car.selectrequest', 'elevator.pickrequest', 'car.choose'],
        guidance:
          'If each car decides for itself, two cars answer the same call and no one owns the building-wide view. Dispatch belongs to a controller; the car takes assignments.',
      },
      {
        id: 'fcfs',
        summary: 'Serving stops strictly first-come-first-served',
        triggers: ['fifo', 'first come first serve', 'fcfs', 'first-in first-out'],
        guidance:
          'A car that passes floor 5 on its way to 9 and then comes back for 5 is a bug people can feel. Sweeping in one direction (the LOOK/SCAN family) is the usual answer: say which you chose and why.',
      },
    ],
    discussionPrompts: [
      'A car is assigned a hall call, then goes into maintenance. Which object notices, and what happens to the call?',
      'Where does the decision "serve floor 5 on the way up" live: the scheduler or the car?',
      'The building wants zoned dispatch during the morning rush. What changes?',
    ],
    tags: ['scheduling', 'state', 'concurrency', 'strategy'],
    rubric: Rubric.of({
      requirement_coverage: 1,
      abstraction_quality: 1.2,
      relationships: 1.2,
      extensibility: 1.2,
      edge_cases: 1.2,
      tradeoff_reasoning: 1.2,
    }),
  });
}

function expenseSplitter(): Problem {
  return new Problem({
    id: ProblemId('prob_expense_splitter'),
    slug: 'expense-splitter',
    title: 'Expense Splitter',
    difficulty: 'medium',
    estimatedMinutes: 45,
    summary:
      'A Splitwise-style ledger. Tests whether you model money as a balance you mutate or as a history you derive from: the answer matters more than it first appears.',
    statement: `Design the object model for a shared-expense tracker.

Users belong to groups. Any member can record an expense they paid for, split among some or all of the group. Splits can be equal, by exact amount, by percentage, or by share units.

At any point a user can see what they owe and what they are owed, both overall and per group. Users settle up by recording a payment to another user.

Model the classes, their responsibilities, and how balances are derived. Be explicit about how money is represented.`,
    constraints: [
      'Single currency is fine, but say what would change for multi-currency.',
      'No real payment integration: settlements are recorded, not executed.',
      'Balances must always reconcile: the sum of everyone\'s position in a group is zero.',
    ],
    requirements: [
      {
        id: 'group',
        kind: 'stated',
        text: 'Users can be grouped, and expenses belong to a group.',
        signals: ['group', 'member', 'membership', 'user'],
      },
      {
        id: 'expense',
        kind: 'stated',
        text: 'A member can record an expense they paid, split among members.',
        signals: ['expense', 'paid', 'payer', 'record', 'amount'],
      },
      {
        id: 'split-types',
        kind: 'stated',
        text: 'Splits can be equal, exact, percentage or share-based.',
        signals: ['equal', 'exact', 'percent', 'percentage', 'share', 'splitstrategy', 'split'],
      },
      {
        id: 'balances',
        kind: 'stated',
        text: 'A user can see what they owe and are owed, overall and per group.',
        signals: ['balance', 'owes', 'owed', 'ledger', 'position', 'net'],
      },
      {
        id: 'settle',
        kind: 'stated',
        text: 'Users can settle up by recording a payment.',
        signals: ['settle', 'settlement', 'payment', 'repay', 'transfer'],
      },
      {
        id: 'rounding',
        kind: 'implied',
        text: 'An equal split of 100 among 3 people does not divide evenly.',
        signals: ['round', 'rounding', 'remainder', 'cent', 'paisa', 'minor unit', 'penny', 'bigdecimal'],
      },
      {
        id: 'validation',
        kind: 'implied',
        text: 'Exact and percentage splits must add up to the expense.',
        signals: ['validate', 'sum', 'must equal', 'invalid', 'total', '100%'],
      },
      {
        id: 'money-type',
        kind: 'implied',
        text: 'Money held as a floating-point number will drift.',
        signals: ['money', 'bigdecimal', 'integer cents', 'minor unit', 'decimal', 'long'],
      },
    ],
    expectedConcepts: [
      {
        name: 'Split strategy',
        aliases: ['splitstrategy', 'splittype', 'equalsplit', 'exactsplit', 'percentsplit', 'sharesplit', 'splitter'],
        why: 'Four ways to divide one amount, and more will be asked for. Each is a small object with the same job; a switch here ages badly.',
      },
      {
        name: 'Money',
        aliases: ['money', 'amount', 'currency', 'bigdecimal', 'cents', 'minorunit'],
        why: 'A dedicated value type is what stops floating-point drift and makes currency explicit rather than assumed.',
      },
      {
        name: 'Ledger entry',
        aliases: ['ledger', 'transaction', 'entry', 'balanceentry', 'journal', 'expenseshare'],
        why: 'Deriving balances from an immutable history, rather than mutating a running total, is what lets an expense be edited or deleted without corrupting everyone\'s position.',
      },
      {
        name: 'Settlement',
        aliases: ['settlement', 'settleup', 'payment', 'transfer', 'repayment'],
        why: 'A settlement is an event in the same history as an expense, not a special case that zeroes a field.',
      },
      {
        name: 'Balance calculation',
        aliases: ['balancesheet', 'balanceservice', 'balancecalculator', 'netbalance', 'simplify'],
        why: 'Who-owes-whom is a projection over entries, and the place where simplification (fewest transfers) would eventually live.',
      },
    ],
    pitfalls: [
      {
        id: 'float-money',
        summary: 'Money represented as a float or double',
        triggers: ['double amount', 'float amount', 'amount: number', 'double balance'],
        guidance:
          'Binary floating point cannot represent 0.10. Over a few hundred splits the group total stops reconciling. Integer minor units or a decimal type, wrapped in a Money value object.',
      },
      {
        id: 'mutable-balance',
        summary: 'A running balance stored on the user',
        triggers: ['user.balance', 'updatebalance', 'balance +=', 'user.owes ='],
        guidance:
          'A mutable total cannot answer "why do I owe this?" and gets corrupted by an edited or deleted expense. Derive balances from the entries; cache the derivation if it ever becomes slow.',
      },
      {
        id: 'switch-split',
        summary: 'Split logic as a switch over a split-type enum',
        triggers: ['switch (splittype', 'if splittype ==', 'switch(type'],
        guidance:
          'The enum and the switch always drift apart. One interface with four implementations puts the validation for each split type next to the arithmetic for it.',
      },
    ],
    discussionPrompts: [
      'Three people split 100 equally. Who gets the extra cent, and which class decides?',
      'Someone edits an expense from last month. What has to happen to the balances?',
      'Add multi-currency. Which classes change, and where does the exchange rate live?',
    ],
    tags: ['money', 'strategy', 'ledger'],
    rubric: Rubric.of({
      requirement_coverage: 1,
      abstraction_quality: 1.2,
      relationships: 1,
      extensibility: 1.2,
      edge_cases: 1.3,
      tradeoff_reasoning: 1.1,
    }),
  });
}
