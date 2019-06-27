import * as t from "io-ts";
import { PathParams, RequestHandlerParams } from "express-serve-static-core"; // eslint-disable-line import/no-unresolved, import/extensions
import { PathReporter } from "io-ts/lib/PathReporter";
import {
  Router,
  NextFunction,
  Request,
  Response,
  RequestHandler
} from "express";
import expressPromiseRouter from "express-promise-router";

export class IoTsValidationError extends Error {
  statusCode = 400;
  name = "IoTsValidationError";

  constructor(message: string) {
    super(message);
    this.message = message;
  }
}

type Omit<O, K> = Pick<O, Exclude<keyof O, K>>;

enum MissingValidator {}
type MissingValidatorC = t.Type<MissingValidator>;

type AddBody<V> = V extends MissingValidator ? {} : { body: V };
type AddParams<V> = V extends MissingValidator ? {} : { params: V };
type AddQuery<V> = V extends MissingValidator ? {} : { query: V };

type ValidatedRequest<Body, Params, Query> = Omit<
  Request,
  "body" | "params" | "query"
> &
  AddBody<Body> &
  AddParams<Params> &
  AddQuery<Query>;

export type ValidatedRequestHandler<
  Body = MissingValidator,
  Params = MissingValidator,
  Query = MissingValidator
> = (
  req: ValidatedRequest<Body, Params, Query>,
  res: Response,
  next: NextFunction
) => any;

interface ValidationRouterMatcher {
  (path: PathParams, ...handlers: ValidatedRequestHandler[]): void;
  (path: PathParams, ...handlers: RequestHandlerParams[]): void;
  <
    B extends t.Type<any, any, any> = MissingValidatorC,
    P extends t.Type<any, any, any> = MissingValidatorC,
    Q extends t.Type<any, any, any> = MissingValidatorC
  >(
    path: PathParams,
    validation: {
      body?: B;
      params?: P;
      query?: Q;
    },
    ...handlers: ValidatedRequestHandler<
      t.TypeOf<B>,
      t.TypeOf<P>,
      t.TypeOf<Q>
    >[]
  ): void;
}

type Method = "post" | "get" | "put" | "delete";
type ValidationRouterMethods = { [method in Method]: ValidationRouterMatcher };
type ValidationRouter = ValidationRouterMethods &
  Omit<Router, Method> &
  RequestHandler;

function validationRoute<
  B extends t.Type<any> = never,
  P extends t.Type<any> = never,
  Q extends t.Type<any> = never
>(reqType: { body?: B; params?: P; query?: Q }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (reqType.params) {
      // TODO: params are always strings, so auto convert t.number to NumberFromString
      const result = reqType.params.decode(req.params);
      // if params don't match then just send this down the middleware stack
      if (result.isLeft()) {
        return next("route");
      }
      req.params = result.value;
    }
    if (reqType.query) {
      const result = reqType.query.decode(req.query);
      // TODO: figure out which reporter we wanna use
      const report = PathReporter.report(result);
      if (result.isLeft()) {
        throw new IoTsValidationError(report.join());
      }
      req.query = result.value;
    }
    if (reqType.body) {
      const result = reqType.body.decode(req.body);
      // TODO: figure out which reporter we wanna use
      const report = PathReporter.report(result);
      if (result.isLeft()) {
        throw new IoTsValidationError(report.join());
      }
      req.body = result.value;
    }
    next();
  };
}

function validationRouter(): ValidationRouter {
  const router = expressPromiseRouter();
  const methods: Method[] = ["get", "post", "put", "delete"];
  methods.forEach(method => {
    const orig = router[method].bind(router);
    // TODO: figure out the anys
    router[method] = (path: any, validation: any, ...handlers: any[]) => {
      // TODO: handle array without path and or validation
      if (typeof validation === "function") {
        return orig(path, validation, ...handlers);
      }
      return orig(path, validationRoute(validation), ...handlers);
    };
  });
  return router as any; // TODO: figure this out
}

export default validationRouter;
