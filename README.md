# Prompt Jump

A bb plugin that adds a round up-arrow button above the composer in each thread's chat. The up arrow is centered when it is the only visible button; when bb's scroll-to-latest arrow appears, the pair is centered together.

- **Click**: scroll up to your previous message. Click again to keep stepping back.
- **Shift-click**: step forward to the next of your messages.

The button hides when the chat is already at the top. bb only renders part of a long chat at a time. When none of your messages is rendered above the view, the button pages up until bb renders one or the chat reaches its top.

The plugin has no settings and no backend. It finds user messages through bb's chat markup (`data-timeline-row-id`, `data-message-column`), so a bb update that changes that markup can break it.
