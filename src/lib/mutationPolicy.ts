let policy: (action: string, args: unknown[]) => boolean = () => true;
export const setMutationPolicy = (next: typeof policy) => {
  policy = next;
};
export const allowMutation = (action: string, args: unknown[]) => policy(action, args);
