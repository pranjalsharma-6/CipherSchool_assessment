import { useCallback } from 'react';
import type {
  StructuredEntity,
  StructuredOperation,
  StructuredRelationship,
  Submission,
} from '../api/types';

/**
 * The structured design form.
 *
 * This component encodes the platform's main product opinion: an LLD attempt is
 * only meaningful if the learner names their classes, says what each is
 * responsible for, and states how they relate. A blank textarea lets someone
 * write three fluent paragraphs that skip all three. The form does not.
 */
export function DesignEditor({
  value,
  onChange,
  disabled,
}: {
  value: Extract<Submission, { format: 'structured' }>;
  onChange: (next: Extract<Submission, { format: 'structured' }>) => void;
  disabled?: boolean;
}) {
  const patch = useCallback(
    (partial: Partial<Extract<Submission, { format: 'structured' }>>) =>
      onChange({ ...value, ...partial }),
    [onChange, value],
  );

  const updateEntity = (index: number, partial: Partial<StructuredEntity>) =>
    patch({
      entities: value.entities.map((e, i) => (i === index ? { ...e, ...partial } : e)),
    });

  const updateRelationship = (index: number, partial: Partial<StructuredRelationship>) =>
    patch({
      relationships: value.relationships.map((r, i) => (i === index ? { ...r, ...partial } : r)),
    });

  const updateOperation = (index: number, partial: Partial<StructuredOperation>) =>
    patch({
      operations: value.operations.map((o, i) => (i === index ? { ...o, ...partial } : o)),
    });

  return (
    <div>
      <section className="card">
        <header className="card-head">
          <div>
            <h2>Classes &amp; interfaces</h2>
            <p className="small faint" style={{ margin: '3px 0 0' }}>
              One line per type. The responsibility is what gets reviewed. If it needs an
              "and", you probably have two classes.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled}
            onClick={() =>
              patch({
                entities: [
                  ...value.entities,
                  { name: '', kind: 'class', responsibility: '', members: [] },
                ],
              })
            }
          >
            + Class
          </button>
        </header>

        <div className="row-editor">
          {value.entities.map((entity, index) => (
            <div className="row-item" key={index}>
              <div className="row-grid row-grid-entity">
                <input
                  aria-label="Class name"
                  placeholder="ParkingLot"
                  className="mono"
                  value={entity.name}
                  disabled={disabled}
                  onChange={(e) => updateEntity(index, { name: e.target.value })}
                />
                <select
                  aria-label="Kind"
                  value={entity.kind}
                  disabled={disabled}
                  onChange={(e) =>
                    updateEntity(index, { kind: e.target.value as StructuredEntity['kind'] })
                  }
                >
                  <option value="class">class</option>
                  <option value="interface">interface</option>
                  <option value="enum">enum</option>
                </select>
                <input
                  aria-label="Responsibility"
                  placeholder="Responsible for..."
                  value={entity.responsibility}
                  disabled={disabled}
                  onChange={(e) => updateEntity(index, { responsibility: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove class"
                  disabled={disabled}
                  onClick={() =>
                    patch({ entities: value.entities.filter((_, i) => i !== index) })
                  }
                >
                  ×
                </button>
              </div>
              <input
                aria-label="Members"
                className="mono"
                style={{ marginTop: 8 }}
                placeholder="Fields and methods, comma separated. For example: park(vehicle), floors, pricing"
                value={entity.members.join(', ')}
                disabled={disabled}
                onChange={(e) =>
                  updateEntity(index, {
                    members: e.target.value
                      .split(',')
                      .map((m) => m.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          ))}
          {value.entities.length === 0 && (
            <p className="small faint">No classes yet. Add the first one to get started.</p>
          )}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <div>
            <h2>Relationships</h2>
            <p className="small faint" style={{ margin: '3px 0 0' }}>
              Who holds a reference to whom, and how many. Cardinality is graded.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled}
            onClick={() =>
              patch({
                relationships: [
                  ...value.relationships,
                  { from: '', to: '', kind: 'association', cardinality: '' },
                ],
              })
            }
          >
            + Relationship
          </button>
        </header>

        <div className="row-editor">
          {value.relationships.map((relationship, index) => (
            <div className="row-item" key={index}>
              <div className="row-grid row-grid-rel">
                <input
                  aria-label="From"
                  className="mono"
                  placeholder="ParkingLot"
                  list="entity-names"
                  value={relationship.from}
                  disabled={disabled}
                  onChange={(e) => updateRelationship(index, { from: e.target.value })}
                />
                <select
                  aria-label="Relationship kind"
                  value={relationship.kind}
                  disabled={disabled}
                  onChange={(e) => updateRelationship(index, { kind: e.target.value })}
                >
                  <option value="association">association</option>
                  <option value="aggregation">aggregation</option>
                  <option value="composition">composition</option>
                  <option value="inheritance">inheritance</option>
                  <option value="implements">implements</option>
                  <option value="dependency">dependency</option>
                </select>
                <input
                  aria-label="To"
                  className="mono"
                  placeholder="ParkingFloor"
                  list="entity-names"
                  value={relationship.to}
                  disabled={disabled}
                  onChange={(e) => updateRelationship(index, { to: e.target.value })}
                />
                <input
                  aria-label="Cardinality"
                  className="mono"
                  placeholder="1..*"
                  value={relationship.cardinality ?? ''}
                  disabled={disabled}
                  onChange={(e) => updateRelationship(index, { cardinality: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove relationship"
                  disabled={disabled}
                  onClick={() =>
                    patch({ relationships: value.relationships.filter((_, i) => i !== index) })
                  }
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {value.relationships.length === 0 && (
            <p className="small faint">
              A list of classes is not yet a design: add at least one relationship.
            </p>
          )}
        </div>

        <datalist id="entity-names">
          {value.entities.map((e) => (
            <option key={e.name} value={e.name} />
          ))}
        </datalist>
      </section>

      <section className="card">
        <header className="card-head">
          <div>
            <h2>Key operations</h2>
            <p className="small faint" style={{ margin: '3px 0 0' }}>
              Optional, but this is where failure paths get noticed. Say what happens when the
              operation cannot succeed.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled}
            onClick={() =>
              patch({ operations: [...value.operations, { name: '', owner: '', description: '' }] })
            }
          >
            + Operation
          </button>
        </header>

        <div className="row-editor">
          {value.operations.map((operation, index) => (
            <div className="row-item" key={index}>
              <div className="row-grid row-grid-op">
                <input
                  aria-label="Operation name"
                  className="mono"
                  placeholder="park(vehicle)"
                  value={operation.name}
                  disabled={disabled}
                  onChange={(e) => updateOperation(index, { name: e.target.value })}
                />
                <input
                  aria-label="Operation description"
                  placeholder="Allocates a fitting spot and issues a ticket; rejects when the lot is full"
                  value={operation.description}
                  disabled={disabled}
                  onChange={(e) => updateOperation(index, { description: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove operation"
                  disabled={disabled}
                  onClick={() =>
                    patch({ operations: value.operations.filter((_, i) => i !== index) })
                  }
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          {value.operations.length === 0 && (
            <p className="small faint">No operations described yet.</p>
          )}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Trade-offs &amp; assumptions</h2>
        <div className="field">
          <label htmlFor="tradeoffs">
            Why this design? Name one alternative you rejected and what it would have cost.
          </label>
          <textarea
            id="tradeoffs"
            rows={7}
            placeholder="I put pricing behind a PricingStrategy rather than a method on Ticket because rate cards change far more often than the domain does..."
            value={value.tradeoffs}
            disabled={disabled}
            onChange={(e) => patch({ tradeoffs: e.target.value })}
          />
          <p className="field-hint">
            This is the highest-signal box on the page. In a real interview it is most of what
            separates two candidates with the same class diagram.
          </p>
        </div>
        <div className="field">
          <label htmlFor="assumptions">Assumptions</label>
          <textarea
            id="assumptions"
            rows={4}
            placeholder="A single physical lot. Payment is taken at exit through an external gateway..."
            value={value.assumptions}
            disabled={disabled}
            onChange={(e) => patch({ assumptions: e.target.value })}
          />
        </div>
      </section>
    </div>
  );
}
