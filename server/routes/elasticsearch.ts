/*
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import { Request, ResponseToolkit } from 'hapi';
import { get } from 'lodash';
//@ts-ignore
import { CallClusterWithRequest } from 'src/legacy/core_plugins/elasticsearch';
import { SearchResponse } from '../models/interfaces';
import {
  CatIndex,
  GetAliasesResponse,
  GetIndicesResponse,
  GetMappingResponse,
  IndexAlias,
  ServerResponse,
} from '../models/types';
import { Router } from '../router';
import { isIndexNotFoundError } from './utils/adHelpers';

export default function (apiRouter: Router) {
  apiRouter.get('/_indices', getIndices);
  apiRouter.get('/_aliases', getAliases);
  apiRouter.get('/_mappings', getMapping);
  apiRouter.post('/_search', executeSearch);
  apiRouter.put('/create_index', createIndex);
  apiRouter.post('/bulk', bulk);
  apiRouter.post('/delete_index', deleteIndex);
}

type SearchParams = {
  index: string;
  size: number;
  body: object;
};

const executeSearch = async (
  req: Request,
  h: ResponseToolkit,
  callWithRequest: CallClusterWithRequest
): Promise<ServerResponse<SearchResponse<any>>> => {
  try {
    const {
      index,
      query,
      size = 0,
      sort = undefined,
      collapse = undefined,
      aggs = undefined,
      rawQuery = undefined,
    } = req.payload as {
      index: string;
      query?: object;
      size?: number;
      sort?: object;
      collapse?: object;
      aggs?: object;
      rawQuery: object;
    };
    const requestBody = rawQuery
      ? rawQuery
      : {
          query: query,
          ...(sort !== undefined && { sort: sort }),
          ...(collapse !== undefined && { collapse: collapse }),
          ...(aggs !== undefined && { aggs: aggs }),
        };

    const params: SearchParams = { index, size, body: requestBody };

    const results: SearchResponse<any> = await callWithRequest(
      req,
      'search',
      params
    );

    return { ok: true, response: results };
  } catch (err) {
    console.error('Anomaly detector - Unable to execute search', err);
    return { ok: false, error: err.message };
  }
};

const getIndices = async (
  req: Request,
  h: ResponseToolkit,
  callWithRequest: CallClusterWithRequest
): Promise<ServerResponse<GetIndicesResponse>> => {
  const { index } = req.query as { index: string };
  try {
    const response: CatIndex[] = await callWithRequest(req, 'cat.indices', {
      index,
      format: 'json',
      h: 'health,index',
    });
    return { ok: true, response: { indices: response } };
  } catch (err) {
    // In case no matching indices is found it throws an error.
    if (
      err.statusCode === 404 &&
      get<string>(err, 'body.error.type', '') === 'index_not_found_exception'
    ) {
      return { ok: true, response: { indices: [] } };
    }
    console.log('Anomaly detector - Unable to get indices', err);
    return { ok: false, error: err.message };
  }
};

const getAliases = async (
  req: Request,
  h: ResponseToolkit,
  callWithRequest: CallClusterWithRequest
): Promise<ServerResponse<GetAliasesResponse>> => {
  const { alias } = req.query as { alias: string };
  try {
    const response: IndexAlias[] = await callWithRequest(req, 'cat.aliases', {
      alias,
      format: 'json',
      h: 'alias,index',
    });
    return { ok: true, response: { aliases: response } };
  } catch (err) {
    console.log('Anomaly detector - Unable to get aliases', err);
    return { ok: false, error: err.message };
  }
};

const createIndex = async (
  req: Request,
  h: ResponseToolkit,
  callWithRequest: CallClusterWithRequest
): Promise<ServerResponse<any>> => {
  //@ts-ignore
  const index = req.payload.indexConfig.index;
  //@ts-ignore
  const body = req.payload.indexConfig.body;
  try {
    await callWithRequest(req, 'indices.create', {
      index: index,
      body: body,
    });
  } catch (err) {
    console.log('Anomaly detector - Unable to create index', err);
    return { ok: false, error: err.message };
  }
  try {
    const response: CatIndex[] = await callWithRequest(req, 'cat.indices', {
      index,
      format: 'json',
      h: 'health,index',
    });
    return { ok: true, response: { indices: response } };
  } catch (err) {
    console.log('Anomaly detector - Unable to get indices', err);
    return { ok: false, error: err.message };
  }
};

const bulk = async (
  req: Request,
  h: ResponseToolkit,
  callWithRequest: CallClusterWithRequest
): Promise<ServerResponse<GetAliasesResponse>> => {
  //@ts-ignore
  const body = req.payload.body;
  try {
    const response: any = await callWithRequest(req, 'bulk', {
      body: body,
    });
    //@ts-ignore
    return { ok: true, response: { response } };
  } catch (err) {
    console.log('Anomaly detector - Unable to perform bulk action', err);
    return { ok: false, error: err.message };
  }
};

const deleteIndex = async (
  req: Request,
  h: ResponseToolkit,
  callWithRequest: CallClusterWithRequest
): Promise<ServerResponse<any>> => {
  //@ts-ignore
  const index = req.payload.index;
  try {
    await callWithRequest(req, 'indices.delete', {
      index: index,
    });
  } catch (err) {
    console.log(
      'Anomaly detector - Unable to perform delete index action',
      err
    );
    // Ignore the error if it's an index_not_found_exception
    if (!isIndexNotFoundError(err)) {
      return { ok: false, error: err.message };
    }
  }
  try {
    const response: CatIndex[] = await callWithRequest(req, 'cat.indices', {
      index,
      format: 'json',
      h: 'health,index',
    });
    return { ok: true, response: { indices: response } };
  } catch (err) {
    console.log('Anomaly detector - Unable to get indices', err);
    return { ok: false, error: err.message };
  }
};

const getMapping = async (
  req: Request,
  h: ResponseToolkit,
  callWithRequest: CallClusterWithRequest
): Promise<ServerResponse<GetMappingResponse>> => {
  const { index } = req.query as { index: string };
  try {
    const response = await callWithRequest(req, 'indices.getMapping', {
      index,
    });
    return { ok: true, response: { mappings: response } };
  } catch (err) {
    console.log('Anomaly detector - Unable to get mappings', err);
    return { ok: false, error: err };
  }
};
