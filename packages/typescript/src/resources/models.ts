import type { ClientContext } from "../client.js";
import {
  addLlmModel,
  addSmallModel,
  deleteLlmModels,
  deleteSmallModels,
  editLlmModel,
  editSmallModel,
  getLlmModel,
  getSmallModel,
  listLlmModels,
  listSmallModels,
  testLlmModel,
  testSmallModel,
  type ListLlmModelsOptions,
  type ListSmallModelsOptions,
  type MfManagerBaseOptions,
} from "../api/models.js";
import {
  modelChatCompletions,
  modelEmbedding,
  modelEmbeddings,
  modelRerank,
  type MfApiBaseOptions,
  type ModelChatCompletionsOptions,
  type ModelEmbeddingOptions,
  type ModelRerankOptions,
} from "../api/model-invocation.js";

type Base = MfManagerBaseOptions;

export class LlmModelsSubresource {
  constructor(private readonly ctx: ClientContext) {}

  list(opts: Omit<ListLlmModelsOptions, keyof Base> & Partial<MfManagerBaseOptions>): Promise<unknown> {
    return listLlmModels({ ...this.ctx.base(), ...opts });
  }

  get(
    modelId: string,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return getLlmModel({ ...this.ctx.base(), modelId, ...opts });
  }

  add(
    body: Record<string, unknown>,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return addLlmModel({ ...this.ctx.base(), body, ...opts });
  }

  edit(
    body: Record<string, unknown>,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return editLlmModel({ ...this.ctx.base(), body, ...opts });
  }

  delete(
    modelIds: string[],
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return deleteLlmModels({ ...this.ctx.base(), modelIds, ...opts });
  }

  test(
    body: Record<string, unknown>,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return testLlmModel({ ...this.ctx.base(), body, ...opts });
  }
}

export class SmallModelsSubresource {
  constructor(private readonly ctx: ClientContext) {}

  list(opts: Omit<ListSmallModelsOptions, keyof Base> & Partial<MfManagerBaseOptions>): Promise<unknown> {
    return listSmallModels({ ...this.ctx.base(), ...opts });
  }

  get(
    modelId: string,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return getSmallModel({ ...this.ctx.base(), modelId, ...opts });
  }

  add(
    body: Record<string, unknown>,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return addSmallModel({ ...this.ctx.base(), body, ...opts });
  }

  edit(
    body: Record<string, unknown>,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return editSmallModel({ ...this.ctx.base(), body, ...opts });
  }

  delete(
    modelIds: string[],
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return deleteSmallModels({ ...this.ctx.base(), modelIds, ...opts });
  }

  test(
    body: Record<string, unknown>,
    opts: Partial<Pick<MfManagerBaseOptions, "mfManagerBaseUrl" | "businessDomain">> = {},
  ): Promise<unknown> {
    return testSmallModel({ ...this.ctx.base(), body, ...opts });
  }
}

export class ModelInvocationSubresource {
  constructor(private readonly ctx: ClientContext) {}

  chat(
    opts: Omit<ModelChatCompletionsOptions, "baseUrl" | "accessToken" | "businessDomain"> &
      Partial<Pick<MfApiBaseOptions, "mfApiBaseUrl" | "businessDomain">>,
  ) {
    const { baseUrl, accessToken, businessDomain } = this.ctx.base();
    return modelChatCompletions({
      baseUrl,
      accessToken,
      businessDomain,
      ...opts,
    });
  }

  embedding(
    opts: Omit<ModelEmbeddingOptions, "baseUrl" | "accessToken" | "businessDomain"> &
      Partial<Pick<MfApiBaseOptions, "mfApiBaseUrl" | "businessDomain">>,
  ) {
    const { baseUrl, accessToken, businessDomain } = this.ctx.base();
    return modelEmbedding({ baseUrl, accessToken, businessDomain, ...opts });
  }

  embeddings(
    opts: Omit<ModelEmbeddingOptions, "baseUrl" | "accessToken" | "businessDomain"> &
      Partial<Pick<MfApiBaseOptions, "mfApiBaseUrl" | "businessDomain">>,
  ) {
    const { baseUrl, accessToken, businessDomain } = this.ctx.base();
    return modelEmbeddings({ baseUrl, accessToken, businessDomain, ...opts });
  }

  rerank(
    opts: Omit<ModelRerankOptions, "baseUrl" | "accessToken" | "businessDomain"> &
      Partial<Pick<MfApiBaseOptions, "mfApiBaseUrl" | "businessDomain">>,
  ) {
    const { baseUrl, accessToken, businessDomain } = this.ctx.base();
    return modelRerank({ baseUrl, accessToken, businessDomain, ...opts });
  }
}

/** Model factory: mf-model-manager (CRUD) + mf-model-api (invoke chat / embedding / rerank). */
export class ModelsResource {
  readonly llm: LlmModelsSubresource;
  readonly small: SmallModelsSubresource;
  readonly invocation: ModelInvocationSubresource;

  constructor(ctx: ClientContext) {
    this.llm = new LlmModelsSubresource(ctx);
    this.small = new SmallModelsSubresource(ctx);
    this.invocation = new ModelInvocationSubresource(ctx);
  }
}
