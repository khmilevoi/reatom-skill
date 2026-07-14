<SYSTEM>Getting Started: Quick start tutorials — atoms, actions, extensions, forms, routing, and tooling</SYSTEM>

# Introduction

> Introduction to Reatom

Welcome to the awesome world of the Reatom library! 🤗 This powerful tool is designed to become your go-to resource for building anything from tiny libraries to full-blown applications. We know the drill: usually, you’d have to keep reinventing the wheel with high-level patterns or depend on external libraries. Both are tough to balance perfectly for interface equality, semantic compatibility, performance, error handling, debugging, logging, test setup, and mocking. To make life easier, we’ve crafted the perfect building blocks (atoms and actions) and a bunch of packages on top of them. These tools tackle the tough stuff so you can focus on being creative. This start guide will walk you through the basic features of Reatom and key ecosystem helpers, such as forms and routing. For more advanced use cases, check out the [guides](/docs/guides/), for a full list of features check out the [reference](/docs/reference/) page. But first of all, check out the [base](/start/base/) guide to get started.

# Actions

> Reatom actions and code organization

Action is a base Reatom primitive that **increases the quality of your code** in many ways: organization and readability, debugability, extensibility. The beauty of Reatom is that you don’t need to use actions for simple updates, like `(value) => myAtom.set(value)`. Actions are useful for complex operations, like data mappings, API calls and other side effects. You can call actions anywhere just like regular functions. You can describe its parameters just like with regular functions. You can type your action function with TypeScript generics as usual. `action` itself is a simple decorator which adds some extra features to your function, but does not limit you in any way. 
```ts
import { atom, action } from '@reatom/core'


export const list = atom([])
const isListLoading = atom(false)


const loadList = action(async (page: number) => {
  isListLoading.set(true)
  try {
    const response = await fetch(`/api/list?page=${page}`)
    const payload = await response.json()
    list.set(payload)
  } finally {
    isListLoading.set(false)
  }
})


loadList(1) // Promise
```
 Note that `action` is an optional feature and not required in your code, but it is always nice to use it. ## Naming [Section titled “Naming”](#naming) Most Reatom units accept an optional name for debugging purposes. We highly recommend using it, as it helps to debug the runtime dataflow. 
```ts
export const list = atom([], 'list')
const isListLoading = atom(false, 'isListLoading')


const loadList = action(async (page: number) => {
  // ...
}, 'loadList')
```
 That’s better! ## Extend [Section titled “Extend”](#extend) Under the hood action is a special type of atom; it gives us the ability to reuse many patterns and extensions. In the next chapter, we will get to know extensions more closely, but for now, let’s learn how to better organize our code. `extend` accept a callback with the processed target, which return an object to assign to the target. 
```ts
import { atom, action } from '@reatom/core'


export const list = atom([], 'list').extend((target) => {
  const isLoading = atom(
    false,
    // compute the name from the target
    `${target.name}.isLoading`,
  )
  const load = action(async (page: number) => {
    // ...
  }, `${target.name}.load`)


  // return things that you want to assign to the current atom
  return {
    isLoading,
    load,
  }
})
```
 Now you can access your states in a clean and readable way: src/component/Paging.tsx 
```tsx
import React from 'react'
import { reatomComponent } from '@reatom/react'
import { list } from './model'


const Paging = reatomComponent(() => {
  const [page, setPage] = React.useState(1)


  React.useEffect(() => {
    list.load(page)
  }, [page])


  const isLoading = list.isLoading()


  return (
    <button onClick={() => setPage((page) => page + 1)} disabled={isLoading}>
      {isLoading ? 'Loading...' : 'Next page'}
    </button>
  )
})


const List = reatomComponent(() => (
  <section>
    <Paging />
    {list().map(/* ... */)}
  </section>
))
```
 Awesome, now you can couple relative states with relative components without a props drilling! But this is just the beginning, `.extend` can give us much more! Check out the next section to learn more about it.

# Getting started

> Learn the base Reatom primitives

## Installation [Section titled “Installation”](#installation) Reatom is a framework agnostic library with various adapters for different frameworks. By default all docs and examples are written for React, but you can reuse each code example with any other framework. 
```bash
npm install @reatom/core @reatom/react
```
 ## Template [Section titled “Template”](#template) For a fast start you can use our template with react.dev and mantine.dev and a set of example features: [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/reatom/reatom/tree/v1001/examples/react-search) ## Core primitives [Section titled “Core primitives”](#core-primitives) ### Atom [Section titled “Atom”](#atom) Reatom has a lot of advanced features under the hood, but they are hidden by default and you can start just with the atom - base state container. 
```typescript
import { atom } from '@reatom/core'


const counter = atom(0)


// Read the atom state
console.log(counter())
// Log: 0


// Write a new state to the atom
counter.set(1)
console.log(counter())
// Log: 1


// Process and update the atom state in a function
counter.set((state) => state + 5)
console.log(counter())
// Log: 6
```
 ### Computed [Section titled “Computed”](#computed) The most valuable feature of any signal-based library is the ability to create lazy memoized computations. 
```typescript
import { atom, computed } from '@reatom/core'


const counter = atom(0)


const isEven = computed(() => counter() % 2 === 0)


console.log(isEven())
// Log: true


counter.set(1)
// Log nothing, the computed has no subscription


// Trigger the computation implicitly
console.log(isEven())
// Log: false
```
 To “activate” a computed you need to subscribe to it. Note, that all reactive computations appear in the next microtask tick, after a dependency change. 
```typescript
// Now any change of the counter will trigger the computation
// and the subscription callback (if the state really changed)
isEven.subscribe((state) => console.log(state))
```
 But in most cases you don’t need to subscribe to atoms manually, you probably want to use them in a high-level computed, such as effects or a UI component, let’s dive into it. ### Effects [Section titled “Effects”](#effects) Effects are a way to react to changes in the state. They are similar to computed, but run immediately after creation. Basically it is just `computed(cb).subscribe()`, but with some extra features which we will investigate later. It is much more useful than just `.subscribe` as you can track many atoms in any combinations in one place. 
```typescript
import { atom, computed, effect } from '@reatom/core'


const counter = atom(0)
const isEven = computed(() => counter() % 2 === 0)


effect(() => {
  console.log(`${counter()} is ${isEven() ? 'even' : 'odd'}`)
})
```
 Typical use case is to run some long-lived processes, such as an API polling, or a timer, which should work independently of a UI. ## Using with framework [Section titled “Using with framework”](#using-with-framework) 
```tsx
import { atom, computed } from '@reatom/core'
import { reatomComponent } from '@reatom/react'


const counter = atom(0)
const isEven = computed(() => counter() % 2 === 0)


const Counter = reatomComponent(() => (
  <section>
    <p>
      {counter()} is {isEven() ? 'even' : 'odd'}
    </p>


    <button onClick={() => counter.set((v) => v + 1)}>Increment</button>
  </section>
))
```
 `reatomComponent` is just a special variant of `computed` that perfectly integrates with React. **The coolest thing** about `reatomComponent` is that you can use reactive states (atoms) in any order without the rules of hooks! ## Conclusion [Section titled “Conclusion”](#conclusion) **That’s all!** If you need a small, performant and useful reactive primitive and nothing more, you can stay with what we discovered just now and move to the [tooling](/start/tooling/) section to get nice logging of your app. If you what to dive deeper and learn more Reatom features, go to the [actions](/start/actions/) section.

# Extensions

> Reatom extensions system

Extensions are **powerful add-ons** that enhance your atoms and actions with common functionality. Instead of writing the same patterns over and over, extensions provide ready-made solutions for async operations, persistence, caching, and much more. The beauty of extensions is that they compose perfectly - you can combine multiple extensions on the same atom to get exactly the behavior you need. Let’s rewrite the data loading example from the [actions](/start/actions/) section using extensions, which add async tracking: src/model.ts 
```ts
import { atom, action, withAsyncData } from '@reatom/core'


const fetchList = action(async (page: number) => {
  const response = await fetch(`/api/data?page=${page}`)
  return await response.json()
}, 'fetchList').extend(withAsyncData({ initState: [] }))


fetchList.ready() // `false` during the fetch
fetchList.data() // the fetch result
fetchList.error() // `Error` or `undefined`, depends on the fetch result


// Use it in the same way
fetchList(1) // Promise
```
 Some extensions can be used only with atoms (like `withMemo`), some only with actions (like `withCallHook`), but many extensions can be used with both! ## withAsyncData [Section titled “withAsyncData”](#withasyncdata) Let’s explore the list loading further. What if we want to add more parameters to the fetching? We could add another argument and pass it through the calling chain, but let’s make it more reliable using the Reatom approach with implicit reactive coupling. src/model.ts 
```ts
import { atom, computed, withAsyncData } from '@reatom/core'


const search = atom('', 'search')
const page = atom(1, 'page')


const listResource = computed(async () => {
  const response = await fetch(`/api/data?search=${search()}&page=${page()}`)
  return await response.json()
}, 'listResource').extend(withAsyncData({ initState: [] }))
```
 Notice how we reduce the amount of code and make the entire flow more optimal! `listResource` is an async computed that reruns only when `page` or `search` changes and **when the data is needed**. By using a computed, we make the effect lazy, meaning it will run only when `listResource.ready()`, `listResource.data()`, or `listResource.error()` is called and used in a component or effect. ## withSearchParams [Section titled “withSearchParams”](#withsearchparams) Let’s enhance our extension system further. We have a few improvements to make: * Let’s sync the parameters with URL search parameters * Let’s reset the page state when search changes * Let’s add handy actions for pagination src/model.ts 
```ts
import { atom, withSearchParams, withComputed, isInit, computed, withAsyncData } from '@reatom/core'


const search = atom('', 'search').extend(withSearchParams('search'))
const page = atom(1, 'page').extend(
  withSearchParams('page'),
  withComputed((state) => {
    search() // subscribe to the search changes
    // do NOT reset the persisted state on init
    return isInit() ? state : 1
  }),
  target => ({
    next: () => target.set(state => state + 1),
    prev: () => target.set(state => Math.max(1, state - 1)),
  })
)


const listResource = computed(async () => {
  const response = await fetch(`/api/data?search=${search()}&page=${page()}`)
  return await response.json()
}, 'listResource').extend(withAsyncData({ initState: [] }))
```
 Perfect! That’s quite comprehensive. In any other framework or library, implementing this seemingly simple logic would be much more complex, but Reatom provides all the utilities you need to solve it elegantly. Let’s examine how to use this loading model in a component. ## Framework bindings [Section titled “Framework bindings”](#framework-bindings) Now let’s connect our reactive model to the UI using `reatomComponent`. This is a regular React component enhanced with computed capabilities - it automatically tracks atom dependencies and triggers re-renders only when subscribed atoms change, ensuring optimal performance. You can call atoms directly as functions and use their actions just like regular functions - no hooks required, no restrictions on conditional logic or loops. At the same time, you can use regular React hooks, accept props, and do anything you would normally do in a React component. src/Results.tsx 
```tsx
import React from 'react'
import { reatomComponent } from '@reatom/react'
import { search, page, listResource } from './model'


const Filters = reatomComponent(() => (
  <div>
    <input
      value={search()}
      onChange={(e) => search.set(e.target.value)}
      placeholder="Search..."
    />
    <div>
      <button onClick={page.prev}>Previous</button>
      <span> {page()}</span>
      <button onClick={page.next}>Next</button>
    </div>
  </div>
))


const List = reatomComponent(() => (
  <section>
    <Filters />
    {listResource.ready() || <div>Loading...</div>}
    <ul>
      {listResource.data().map((item, index) => (
        <li key={index}>{/* render your item */}</li>
      ))}
    </ul>
  </section>
))
```
 ## Conclusion [Section titled “Conclusion”](#conclusion) One of the key features of `withAsyncData` is that it automatically aborts the previous request when a new one is initiated. So when a user types quickly in the search field and triggers multiple requests, only the most recent one will be processed! > You can dive deeper into the rabbit hole of concurrency management in the [async context](/handbook/async-context/) article. However, when you need to *put* / *post* data, you don’t need the autoabort strategy and the result data storing, for this cases you should use `withAsync` extension for your async actions, which only tracks the loading status and possible errors. Reatom ecosystem has a lot of other extensions, try to search the docs! But sometimes, you need a little more, not an extension for one atom or actions, but a factory to build a set of complex models. Check the next section to learn about form management!

# Forms

> Getting started with forms in Reatom

Reatom has a very advanced form management system to handle complex cases in a type-safe and performant way. You can read more about it in the [form handbook section](/handbook/forms/introduction). But in this guide, we’ll introduce only the basics. ## Creating a form [Section titled “Creating a form”](#creating-a-form) loginForm.ts 
```ts
import { reatomForm } from '@reatom/core'


export const loginForm = reatomForm(


  {
    username: '',
    password: '',
    passwordDouble: '',
  },
  {
    validate({ password, passwordDouble }) {
      if (password !== passwordDouble) {
        return 'Passwords do not match'
      }
    },
    onSubmit: async (
      values /*: { username: string, password: string, passwordDouble: string }*/,
    ) => {
      return await api.login(values)
    },
    validateOnBlur: true,


    name: 'loginForm',
  },
)
```
 The first argument defines your form structure (`initState`). It doesn’t have to be flat - you can nest fields in logical groups using objects. For each key, define the default value, and Reatom will derive the field type from the primitive value. Each field value can be configured by passing a `reatomField` factory with various options (including individual validation) instead of a primitive value. But for primitive values, Reatom creates a field atom automatically. This is called “atomization” and it gives us many advantages. ## Form structure [Section titled “Form structure”](#form-structure) The form instance itself (`loginForm`) has a `submit` action, of course, and computed validation and focus states. It computes from the individual field atoms, which you can find in the `loginForm.fields` object. 
```ts
loginForm.fields satisfies {
  username: FieldAtom<string, string>
  password: FieldAtom<string, string>
  passwordDouble: FieldAtom<string, string>
}
```
 Each field atom includes meta atoms like `validation`, `focus`, and others, which you can use for precise control over the form and each field. ## Framework bindings [Section titled “Framework bindings”](#framework-bindings) LoginForm.tsx 
```tsx
import { reatomComponent, bindField } from '@reatom/react'
import { Button, TextInput, PasswordInput, Stack, Alert } from '@mantine/core'
import { loginForm } from './loginForm'


export const LoginForm = reatomComponent(() => {
  const { submit, fields } = loginForm
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        loginForm.submit()
      }}
    >
      <Stack>
        <TextInput
          label="Username"
          placeholder="Enter your username"
          {...bindField(fields.username)}
        />


        <PasswordInput
          label="Password"
          placeholder="Enter your password"
          {...bindField(fields.password)}
        />


        <PasswordInput
          label="Confirm Password"
          placeholder="Confirm your password"
          {...bindField(fields.passwordDouble)}
        />


        <Button type="submit" loading={!submit.ready()}>
          Login
        </Button>
      </Stack>
    </form>
  )
})
```
 This is a simple example, but note that since we have each field as separate atoms, we can create a separate component for each of them and it would be highly optimized and flexible. You can check out a live example in [StackBlitz](https://stackblitz.com/github/reatom/reatom/tree/v1001/examples/react-search). For native DOM JSX, see the [JSX reference — Forms](/reference/jsx#forms). Next, you’ll want to learn our routing system in the next page ;)

# Routing

> Dead simple and powerful Reatom router for your application state.

Reatom provides a powerful yet simple way to manage your application’s routes and the state associated with them. This guide will introduce you to the basics, focusing on how routing can help manage data lifecycles, such as for forms. ## Defining a Route [Section titled “Defining a Route”](#defining-a-route) You create routes using the `route` function, a route becomes active when the URL matches its path. Let’s imagine a login page: src/routes.ts 
```ts
import { reatomRoute } from '@reatom/core'


export const loginRoute = reatomRoute({
  path: '/login',
})
```
 When the user navigates to `/login`, `loginRoute()` will return an empty object `{}` (as there are no parameters in the pattern). If the URL is different, it will return `null`. ## Route Loaders for State Management [Section titled “Route Loaders for State Management”](#route-loaders-for-state-management) A powerful feature is the `loader` option in a route definition. This function executes when the route becomes active and can be used to load data, it uses async data extension, which we was introduced in the [Extensions guide](/start/extensions). The more more cool feature is that you can create state that should only exist while the route is active. We call it a “computed factory” pattern. This is perfect for managing forms, for example. By creating a form inside a route’s loader, you ensure it’s fresh every time the user visits the route and is automatically cleaned up when they navigate away, preventing issues like old data appearing after logout. But still, the state is global, so you can access them from any component. Let’s adapt our `loginForm` example from the Forms guide: src/routes.ts 
```ts
import { reatomRoute, reatomForm } from '@reatom/core'
// import * as api from './api' // Assuming you have an API module


export const loginRoute = reatomRoute({
  path: '/login',
  async loader() {
    // This form is created ONLY when /login is active
    // and destroyed when navigating away.
    const loginForm = reatomForm(
      {
        username: '',
        password: '',
        passwordDouble: '',
      },
      {
        validate({ password, passwordDouble }) {
          if (password !== passwordDouble) {
            return 'Passwords do not match'
          }
        },
        onSubmit: async (values) => {
          // return await api.login(values)
          console.log('Submitting login form:', values)
          await new Promise((r) => setTimeout(r, 1000))
          return { success: true }
        },
        validateOnBlur: true,
        name: 'loginForm', // for debugging
      },
    )


    return { loginForm }
  },
})
```
 Now, `loginRoute.loader.data()` will contain `{ loginForm }` when the `/login` route is active and the loader has completed. ## Using the Route and Form in a Component [Section titled “Using the Route and Form in a Component”](#using-the-route-and-form-in-a-component) Your React component can then access the form through the route’s loader. src/components/LoginPage.tsx 
```tsx
import { reatomComponent, bindField } from '@reatom/react'
import { Button, TextInput, PasswordInput, Stack, Alert } from '@mantine/core'
import { loginRoute } from '../routes' // Assuming routes.ts


export const LoginPage = reatomComponent(() => {
  if (!loginRoute.loader.ready()) return <div>Loading login page...</div>


  const { submit, fields } = loginRoute.loader.data().loginForm


  return // your form here
}, 'LoginPage')
```
 When the user navigates away from `/login`, the `loginForm` instance created by the loader is automatically garbage-collected. If they navigate back, a new, fresh instance is created. This elegant pattern is called “Computed Factory” and solves many state lifecycle problems. This approach ensures that your form state is always clean and tied to the relevant view, enhancing predictability and reducing bugs. For more advanced routing scenarios, including nested routes, parameter validation, and global loading states, refer to the [handbook routing section](/handbook/routing).

# Tooling

> The list of key tools for Reatom

## Logging [Section titled “Logging”](#logging) Reatom has incredible capabilities for debugging and tracing your code. We will publish our devtools soon, but now you can use `connectLogger` for simple (or not!) logging. main.tsx 
```tsx
import './setup' // import setup file before all other modules!
import ReactDOM from 'react-dom/client'
import { App } from './app'


const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<App />)
```
 For better logging, you can use built-in `log` function, it will forward all arguments to the native `console.log`. setup.ts 
```ts
import { connectLogger, log } from '@reatom/core'


if (import.meta.env.MODE === 'development') {
  connectLogger()
}


declare global {
  var LOG: typeof log
}
globalThis.LOG = log
```
 You can filter or highlight logs with the `match` option: setup.ts 
```ts
connectLogger({
  match: (name, { state }) => {
    // filter unwanted logs
    if (name.includes('internal')) return false


    if (name.includes('error')) {
      // highlight important logs
      return state?.code === 403 ? 'orange' : 'red'
    }


    // pass other logs
    return true
  },
})
```
 ### Log action [Section titled “Log action”](#log-action) `log` may give you huge DX impact: * the name is short name and handy * it will trace the relative call stack and show each time * **you can put it everywhere** and commit to the source code, logs will not be visible in production * you can extend it! `log` is an action, which means you can extend it with `withCallHook` or other action extensions to add custom behavior (e.g., sending logs to a remote service, filtering specific log types, etc.). 
```ts
import { withCallHook } from '@reatom/core'


LOG.extend(
  withCallHook((params) => {
    // Send logs to a remote service
    sendToAnalytics({ level: 'debug', args: params })
  }),
)
```
 ## Eslint [Section titled “Eslint”](#eslint) We recommend using ESLint to enforce best practices and coding standards in your Reatom projects. We will publish our own ESLint plugin for name autofix soon, but you can use this plugin right now to automate `action`, `computed`, `effect` naming: * <https://github.com/artalar/eslint-plugin-react-component-name> 
```json
{
  "plugins": ["react-component-name"],
  "rules": {
    "prefer-arrow-callback": ["error", { "allowNamedFunctions": true }],


    "react-component-name/react-component-name": [
      "error",
      {
        "targets": ["action", "computed", "effect", "reatomComponent"]
      }
    ]
  }
}
```
 Additionally to control the use of `wrap` inside `action`, `computed`, and `effect`, you can use this rule. It does not require installing any additional packages and ensures that all promises whose values are retrieved via await are wrapped in wrap.: 
```json
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "CallExpression:matches([callee.name=\"action\"], [callee.name=\"computed\"], [callee.name=\"effect\"]) ArrowFunctionExpression AwaitExpression > :not(CallExpression[callee.name=\"wrap\"])",
        "message": "Any awaited Promise inside \"action\", \"effect\", or \"computed\" must be wrapped with wrap()"
      }
    ]
  }
}
```
 ## Global Extensions [Section titled “Global Extensions”](#global-extensions) You can automatically track all Reatom entities (atoms and actions) in your application using global extensions. This is particularly useful for analytics, monitoring, debugging, or logging. Track user interactions by monitoring action calls: setup.ts 
```ts
import { addGlobalExtension, isAction, withCallHook } from '@reatom/core'


addGlobalExtension((target) => {
  if (isAction(target)) {
    target.extend(
      withCallHook((payload, params) => {
        analytics.track('action_called', {
          action: target.name,
          timestamp: Date.now(),
          params: JSON.stringify(params),
        })
      }),
    )
  }
  return target
})
```
 Call `addGlobalExtension` early in your application initialization before creating any atoms or actions, as in `connectLogger` example,. Extensions are applied only to entities created after registration. You can learn more about extensions development in the [Extensions](../handbook/extensions.md) chapter.
