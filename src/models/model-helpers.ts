import { UpdateEvent } from "typeorm";

export function setColumnsToUpdate(event: UpdateEvent<any>, state: object): void {
  state = {};
  event.updatedColumns.map((column) => {
    const key: string = column.databaseNameWithoutPrefixes;

    const currValue = event.databaseEntity[column.propertyName];
    const nextValue = event.entity[column.propertyName];

    if (currValue != nextValue) {
      state[key] = nextValue;
    }
  });
}

export function setUpdatedColumns(event: UpdateEvent<any>, state: object): void {
  state = {};
  event.updatedColumns.forEach((column) => {
    const key: string = column.databaseNameWithoutPrefixes;

    const expectedValue = this.prevColumnsToUpdate[key]
    const actualValue = event.databaseEntity[column.propertyName]
    if (actualValue == expectedValue) {
      state[key] = actualValue
    }
  });
}
