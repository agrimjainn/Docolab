'use client';

import { CopilotPlugin } from '@platejs/ai/react';
import { toTPlatePlugin } from 'platejs/react';
import { useDocument } from '@/lib/store/document-store';
import { getToken } from '@/lib/api/client';

export const autocompletePlugin = toTPlatePlugin(
  CopilotPlugin,
  ({ editor }) => {
    // Get docId and token from React context
    const { docId } = useDocument();
    const token = getToken();

    return {
      options: {
        triggerQuery: (options) => {
          if (options.editor.api.some({ match: { type: editor.getType('codeBlock') } })) {
            return false;
          }
          if (options.editor.api.some({ match: { type: editor.getType('equation') } })) {
            return false;
          }
          return !options.editor.selection || options.editor.selection.anchor.offset > 0;
        },
        autoTriggerQuery: (options) => {
          if (options.editor.api.some({ match: { type: editor.getType('codeBlock') } })) {
            return false;
          }
          if (options.editor.api.some({ match: { type: editor.getType('equation') } })) {
            return false;
          }
          const { selection } = options.editor;
          if (!selection || !selection.anchor || selection.anchor.offset === 0) {
            return false;
          }
          const block = options.editor.api.block({ highest: true });
          if (!block) return false;
          return block.children[0]?.text?.endsWith(' ') ?? false;
        },
        getPrompt: (options) => {
          const { editor } = options;
          const block = editor.api.block({ highest: true });
          if (!block) return '';
          return editor.tf.serialize(block, { format: 'markdown' });
        },
        completeOptions: {
          api: '/api/ai/copilot',
          body: {
            documentId: docId,
            model: 'gemini-2.5-flash',
            system: 'Complete the text naturally. Return only the completion, no explanations.',
            token,
          },
        },
      },
    };
  }
).configure({
  render: {
    node: ({ props, editor }) => {
      const { element } = props;
      const isSuggested = editor.getApi(autocompletePlugin).copilot.isSuggested?.(element.id);
      return (
        <span
          {...props}
          style={{
            ...props.style,
            opacity: isSuggested ? 0.5 : 1,
            color: isSuggested ? '#888' : 'inherit',
            pointerEvents: 'none',
          }}
        />
      );
    },
  },
});

export const AutocompleteKit = [autocompletePlugin];