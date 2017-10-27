import R from 'ramda'
import { take, put, call, select, takeEvery, takeLatest } from 'redux-saga/effects'
import { delay } from 'redux-saga'
import { push } from 'react-router-redux'
import pluralize from 'pluralize'
import { decamelize } from 'xcase'
import {
  apiSaga,
  dispatchEnvUpdateRequestIfNeeded,
  dispatchEnvUpdateRequest,
  clearSubEnvServersIfNeeded,
  addDefaultSubEnvServerIfNeeded
} from './helpers'
import {
  getEnvActionsPendingByEnvUpdateId,
  getObject
} from 'selectors'
import {
  UPDATE_ENV_REQUEST,
  UPDATE_ENV_SUCCESS,
  UPDATE_ENV_FAILED,
  CREATE_ENTRY,
  UPDATE_ENTRY,
  REMOVE_ENTRY,
  UPDATE_ENTRY_VAL,
  ADD_SUB_ENV,
  REMOVE_SUB_ENV,
  RENAME_SUB_ENV,
  FETCH_OBJECT_DETAILS_SUCCESS,
  VERIFY_ORG_PUBKEYS_SUCCESS,
  fetchObjectDetails,
  updateEnvRequest,
  socketBroadcastEnvsStatus
} from "actions"
import { isOutdatedEnvsResponse } from 'lib/actions'
import isElectron from 'is-electron'

const onUpdateEnvRequest = apiSaga({
  authenticated: true,
  method: "patch",
  actionTypes: [UPDATE_ENV_SUCCESS, UPDATE_ENV_FAILED],
  minDelay: 800,
  urlFn: ({meta: {parentType, parentId}})=> {
    const urlSafeParentType = decamelize(pluralize(parentType))
    return `/${urlSafeParentType}/${parentId}/update_envs.json`
  }
})

function* onTransformEnv(action){
  if(!action.meta.importAction){
    yield call(dispatchEnvUpdateRequestIfNeeded, {...action, ...action.meta})
    if(!action.meta.queued){
      yield put(socketBroadcastEnvsStatus())
    }
  }
}

function* onUpdateEnvSuccess(action){
  yield call(clearSubEnvServersIfNeeded, action)
  yield call(addDefaultSubEnvServerIfNeeded, action)
  yield call(dispatchEnvUpdateRequestIfNeeded, {...action, ...action.meta, skipDelay: true})
}

function* onUpdateEnvFailed(action){
  if (isOutdatedEnvsResponse(action)){
    const {payload, meta: {parentType, parentId, envUpdateId}} = action

    yield put(fetchObjectDetails({
      objectType: parentType,
      targetId: parentId,
      decryptEnvs: true,
      isOutdatedEnvsRequest: true
    }))

    yield take(FETCH_OBJECT_DETAILS_SUCCESS)

    const envActionsPending = yield select(getEnvActionsPendingByEnvUpdateId(parentId, envUpdateId))

    for (let pendingAction of envActionsPending){
      try {
        const reloadedParent = yield select(getObject(parentType, parentId))
        yield put({...pendingAction, meta: {...pendingAction.meta, parent: reloadedParent}})
      } catch (e){
        console.log("Replay pending envs error")
        console.log(e)
        alert(`There was a problem applying your update to ${pendingAction.payload.entryKey}. This variable may have been deleted or renamed by another user.`)
      }
    }

    yield call(dispatchEnvUpdateRequest, {
      ...action,
      ...action.meta,
      meta: {...action.meta, forceEnvUpdateId: envUpdateId, isOutdatedEnvsRequest: true}
    })
  }
}

function* onAddSubEnv({payload: {environment, id}}){
  const path = isElectron() ? window.location.hash.replace("#", "") : window.location.href,
        newPath = path.replace(new RegExp(`/${environment}/add$`), `/${environment}/${id}`)

  console.log("\n\npath: ", path)
  console.log("newPath: ", newPath)

  yield put(push(newPath))
}

function* onRemoveSubEnv({payload: {environment, id}}){
  const path = isElectron() ? window.location.hash.replace("#", "") : window.location.href,
        newPath = path.replace(new RegExp(`/${environment}/${id}$`),`/${environment}/first`)
  if(path != newPath)yield put(push(newPath))
}

export default function* envSagas(){
  yield [
    takeEvery([
      CREATE_ENTRY,
      UPDATE_ENTRY,
      REMOVE_ENTRY,
      UPDATE_ENTRY_VAL,
      ADD_SUB_ENV,
      REMOVE_SUB_ENV,
      RENAME_SUB_ENV
    ], onTransformEnv),

    takeLatest(ADD_SUB_ENV, onAddSubEnv),
    takeLatest(REMOVE_SUB_ENV, onRemoveSubEnv),

    takeLatest(UPDATE_ENV_REQUEST, onUpdateEnvRequest),
    takeLatest(UPDATE_ENV_SUCCESS, onUpdateEnvSuccess),
    takeLatest(UPDATE_ENV_FAILED, onUpdateEnvFailed)
  ]
}
