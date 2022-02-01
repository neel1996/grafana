import { ThunkResult } from '../../../types';
import {
  getDashboardEditorVariables,
  getNewDashboardVariableIndex,
  getVariable,
  getVariablesByKey,
} from '../state/selectors';
import {
  changeVariableNameFailed,
  changeVariableNameSucceeded,
  clearIdInEditor,
  setIdInEditor,
  variableEditorMounted,
  variableEditorUnMounted,
} from './reducer';
import { variableAdapters } from '../adapters';
import { AddVariable, KeyedVariableIdentifier } from '../state/types';
import { cloneDeep } from 'lodash';
import { VariableType } from '@grafana/data';
import { addVariable, removeVariable } from '../state/sharedReducer';
import { updateOptions } from '../state/actions';
import { VariableModel } from '../types';
import { initInspect } from '../inspect/reducer';
import { createUsagesNetwork, transformUsagesToNetwork } from '../inspect/utils';
import { toKeyedAction } from '../state/keyedVariablesReducer';
import { toKeyedVariableIdentifier, toVariablePayload } from '../utils';

export const variableEditorMount = (identifier: KeyedVariableIdentifier): ThunkResult<void> => {
  return async (dispatch) => {
    const { stateKey: uid } = identifier;
    dispatch(toKeyedAction(uid, variableEditorMounted({ name: getVariable(identifier).name })));
  };
};

export const variableEditorUnMount = (identifier: KeyedVariableIdentifier): ThunkResult<void> => {
  return async (dispatch, getState) => {
    const { stateKey: uid } = identifier;
    dispatch(toKeyedAction(uid, variableEditorUnMounted(toVariablePayload(identifier))));
  };
};

export const onEditorUpdate = (identifier: KeyedVariableIdentifier): ThunkResult<void> => {
  return async (dispatch) => {
    await dispatch(updateOptions(identifier));
    dispatch(switchToListMode(identifier.stateKey));
  };
};

export const changeVariableName = (identifier: KeyedVariableIdentifier, newName: string): ThunkResult<void> => {
  return (dispatch, getState) => {
    const { id, stateKey: uid } = identifier;
    let errorText = null;
    if (!newName.match(/^(?!__).*$/)) {
      errorText = "Template names cannot begin with '__', that's reserved for Grafana's global variables";
    }

    if (!newName.match(/^\w+$/)) {
      errorText = 'Only word and digit characters are allowed in variable names';
    }

    const variables = getVariablesByKey(uid, getState());
    const foundVariables = variables.filter((v) => v.name === newName && v.id !== id);

    if (foundVariables.length) {
      errorText = 'Variable with the same name already exists';
    }

    if (errorText) {
      dispatch(toKeyedAction(uid, changeVariableNameFailed({ newName, errorText })));
      return;
    }

    dispatch(completeChangeVariableName(identifier, newName));
  };
};

export const completeChangeVariableName = (identifier: KeyedVariableIdentifier, newName: string): ThunkResult<void> => (
  dispatch,
  getState
) => {
  const { stateKey: uid } = identifier;
  const originalVariable = getVariable(identifier, getState());
  if (originalVariable.name === newName) {
    dispatch(toKeyedAction(uid, changeVariableNameSucceeded(toVariablePayload(identifier, { newName }))));
    return;
  }
  const model = { ...cloneDeep(originalVariable), name: newName, id: newName };
  const global = originalVariable.global;
  const index = originalVariable.index;
  const renamedIdentifier = toKeyedVariableIdentifier(model);

  dispatch(toKeyedAction(uid, addVariable(toVariablePayload(renamedIdentifier, { global, index, model }))));
  dispatch(toKeyedAction(uid, changeVariableNameSucceeded(toVariablePayload(renamedIdentifier, { newName }))));
  dispatch(switchToEditMode(renamedIdentifier));
  dispatch(toKeyedAction(uid, removeVariable(toVariablePayload(identifier, { reIndex: false }))));
};

export const switchToNewMode = (key: string, type: VariableType = 'query'): ThunkResult<void> => (
  dispatch,
  getState
) => {
  const id = getNextAvailableId(type, getVariablesByKey(key, getState()));
  const identifier = { type, id, stateKey: key };
  const global = false;
  const index = getNewDashboardVariableIndex(key, getState());
  const model = cloneDeep(variableAdapters.get(type).initialState);
  model.id = id;
  model.name = id;
  model.stateKey = key;
  dispatch(
    toKeyedAction(
      key,
      addVariable(
        toVariablePayload<AddVariable>(identifier, { global, model, index })
      )
    )
  );
  dispatch(toKeyedAction(key, setIdInEditor({ id: identifier.id })));
};

export const switchToEditMode = (identifier: KeyedVariableIdentifier): ThunkResult<void> => (dispatch) => {
  const { stateKey: uid } = identifier;
  dispatch(toKeyedAction(uid, setIdInEditor({ id: identifier.id })));
};

export const switchToListMode = (uid: string): ThunkResult<void> => (dispatch, getState) => {
  dispatch(toKeyedAction(uid, clearIdInEditor()));
  const state = getState();
  const variables = getDashboardEditorVariables(uid, state);
  const dashboard = state.dashboard.getModel();
  const { usages } = createUsagesNetwork(variables, dashboard);
  const usagesNetwork = transformUsagesToNetwork(usages);

  dispatch(toKeyedAction(uid, initInspect({ usages, usagesNetwork })));
};

export function getNextAvailableId(type: VariableType, variables: VariableModel[]): string {
  let counter = 0;
  let nextId = `${type}${counter}`;

  while (variables.find((variable) => variable.id === nextId)) {
    nextId = `${type}${++counter}`;
  }

  return nextId;
}
