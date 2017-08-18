import wx from 'labrador-immutable';
import request from 'al-request';
import _ from "lodash";
import { select, put } from 'redux-saga/effects';
import { getCacheId, getCacheData, getCurrentAppKey, getToken, getOpenid } from '../selectors';
import * as cacheActions from '../redux/cache';
import * as handelError from './handel-error';

import { openSocket } from '../utils/openSocket';
//REST头部，包括token和appKey
export function* restHeader(inputAppKey = null) {
    try {
        let token = yield select(getToken);
        let appKey = (inputAppKey) ? inputAppKey : yield select(getCurrentAppKey);
        let header = (appKey) ? { token: token, appKey: appKey } : { token: token };
        return header;
    } catch (err) {
        console.log(err);
        throw err;
    }
}

//最基本的PUT操作
export function* putOperation(url, postObj) {
    try {
        let header = yield restHeader();
        let restObj = yield request.put(url,
            ((postObj) ? postObj : {
                jpush_str1: ""
            }),
            header);
        yield handelError.handelMessageError(restObj);
        return restObj
    } catch (error) {
        yield handelError.loginErrorHandel(error);
        console.log('REST put error->', error);
        throw error || 'REST put error->';
    }

}

//最基本的DELETE操作
export function* deleteOperation(url, delParams) {
    try {
        let header = yield restHeader();
        let restObj = yield request.delete(url, ((delParams) ? delParams : undefined), header);
        yield handelError.handelMessageError(restObj);
        return restObj
    } catch (error) {
        yield handelError.loginErrorHandel(error);
        console.log('REST DELETE error->', error);
        throw error || 'REST DELETE error->';
    }

}

//最基本的POST操作
export function* post(url, postAction, postObj) {
    try {
        let header = yield restHeader();
        let restObj = yield request.post(url + ((postAction) ? '?taskAction=' + postAction : ''),
            ((postObj) ? postObj : {
                jpush_str1: ""
            }),
            header);
        yield handelError.handelMessageError(restObj);
        if (_.get(restObj, 'taskPath')) {
            return restObj
        } else {
            return _.get(restObj, 'qrcodePath') || _.get(restObj, 'message_rest')
        }
    } catch (error) {
        yield handelError.loginErrorHandel(error);
        console.error('REST post error->', error);
        throw error || 'REST post error';
    }
}

export function* getOpenidFunc() {
    try {
        let openid = yield select(getOpenid);
        if (!openid) throw handelError.NO_OPENID;
        return openid;
    } catch (error) {
        console.log('getOpenid', error);
        yieldhandelError.loginErrorHandel(error);
    }
}
export function* getThirdId() {
    try {
        const openid = yield getOpenidFunc();
        return {
            thirdType: 'wx_mini',
            thirdId: openid
        };
    } catch (error) {
        console.log('getThirdId', error)
    }
}

export function* getTemplate(formId, companyName = null, nodeName = null) {
    try {
        const openid = yield getOpenidFunc();
        let obj = {
            "touser": openid,
            "page": "pages/indexWe/indexWe?redirectUrl=../taskDetail/taskDetail?taskId={{id}}",
            "form_id": formId
        };
        if (companyName) obj = Object.assign({}, obj, { companyName: companyName });
        let templateObj = {};
        if (nodeName) {
            templateObj[nodeName] = JSON.stringify(obj);
        } else {
            templateObj['jpush_str2'] = JSON.stringify(obj);
        }
        return templateObj;
    } catch (error) {
        console.log('getTemplate', error)
    }
}

//用于带formId的post
export function* taskPost(url, postAction = 'getlist', postObj = {}, formId = null, isJsonContent = false, page) {
    let returnObj;
    try {
        const templateObj = yield getTemplate(formId);
        postObj = Object.assign({}, postObj, templateObj);
        const { taskPath, message_rest } = yield post(url, postAction, postObj);
        const taskId = taskPath.split('tasksMessages/')[1];
        returnObj = {
            taskId: taskId,
            text: message_rest.text
        };
        yield wx.sendSocketMessage({ data: `hello${postAction}` });
        return returnObj;
    } catch (error) {
        if (error.toString().indexOf('sendSocketMessage:fail') !== -1) {
            yield openSocket();
            return returnObj;
        } else {
            console.error('taskPost error->', error);
            throw error || 'taskPost error';
        }
    }
}

export function* postAndPoll(url, postAction = 'getlist', postParams = {}) {
    try {
        const templateObj = yield getTemplate();
        const postObj = Object.assign({}, postParams, templateObj);
        yield post(url, postAction, postObj);
        const sendSocketMessage = yield wx.sendSocketMessage({ data: `hello${postAction}` });
    } catch (error) {
        if (error.toString().indexOf('sendSocketMessage:fail') !== -1) {
            yield openSocket();
        } else {
            console.error('postAndPoll error', error);
            throw error || 'postAndPoll error->';
        }
    }
}

function* getTaskStatus(taskPath) {
    try {
        let task = yield getData(taskPath);
        return {
            id: _.get(task, 'entities[0].id'),
            message_pushed: _.get(task, 'entities[0].message_pushed'),
            task_status: _.get(task, 'entities[0].task_status')
        }
    } catch (error) {
        console.log('REST getTaskStatus error->', error);
        throw 'REST getTaskStatus error->' + error;
    }
};

/**
 * metadata需要缓存
 */
function* getMetadata(metadataPath, getParams) {
    try {

        let metadataId = yield select(getCacheId, metadataPath);
        if (metadataId) return metadataId;
        const restObj = yield get(metadataPath, getParams);
        const result = _.get(restObj, 'page.results');
        const listMetadata = _.get(result, '[0].FormatJson');
        let metadata = listMetadata ? JSON.parse(listMetadata) : result; //return list的metadata//return detail的metadata
        yield put(cacheActions.create({ url: metadataPath, value: metadata }));
        metadataId = yield select(getCacheId, metadataPath);
        return metadataId;
    } catch (error) {
        throw 'REST getMetadata error->' + error;
    }
}

function* getLookupData(url) {
    try {
        const restObj = yield get(url, { lookUp: 'X' });
        return _.get(restObj, 'page.results[0]') || {};
    } catch (err) {
        throw 'REST getLookupData error->' + error;
    }
}

export function* getData(url, getParams = { pageIndex: 1, pageSize: 1000 }, inputAppKey = null) {
    try {
        const restObj = yield get(url, getParams, inputAppKey) || {};
        const { keywords = null } = getParams;
        const {
            message_rest,
            metadataPath,
            message_sap,
            keyFields,
            href,
            page = {},
            refresh
        } = restObj;
        const { pageIndex = 1, pageSize = 0, totalPage = 0, totalCount = 0 } = page;
        let metadataId = (metadataPath) ? yield getMetadata(metadataPath) : undefined;
        let metadata = (metadataId) ? yield select(getCacheData, metadataId) : undefined;
        const type = (url.indexOf('sap/search/') !== -1) ? 'SEARCH_LIST' :
            ((_.isArray(metadata)) ? 'DETAIL' : 'LIST'); //用于判断searchList,detail还是list
        let lookupData = (type === 'DETAIL') ? yield getLookupData(url) : undefined;
        return {
            message_sap: message_sap, //仅拥有SAP message
            entities: _.get(page, 'results') || [],
            metadataPath: metadataPath,
            refresh: refresh,
            message_rest: message_rest,
            params: {
                metadataId: metadataId,
                keyFields: keyFields,
                href: href,
                type: type,
                loadMore: ((totalPage > pageIndex) && (totalCount > 0)),
                lookupData: lookupData,
                pageIndex: pageIndex,
                pageSize: pageSize,
                totalPage: totalPage,
                totalCount: totalCount,
                keywords: keywords,
            }
        }
    } catch (error) {
        console.log(error)
        console.log('REST getData error->')
        throw  error;
    }
}

//最基本的GET操作
export function* get(url, getParams, inputAppKey = null) {
    try {
        let header = yield restHeader(inputAppKey);
        if (!url) throw 'no root';
        let restObj = yield request.get(url, (getParams ? getParams : undefined), header);
        yield handelError.handelMessageError(restObj);
        return restObj
    } catch (error) {
        yield handelError.loginErrorHandel(error);
        console.log(error);
        throw error || 'REST get error->';
    }
}