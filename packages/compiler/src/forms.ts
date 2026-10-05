import { renderAttrs } from './html.js'

/** A honeypot only bots fill, and the form's name for the email. */
export const formFields = (name: string) =>
  `<div style="position:absolute;left:-10000px" aria-hidden="true"><input name="_lacuno_hp" tabindex="-1" autocomplete="off"></div><input${renderAttrs({ type: 'hidden', name: '_lacuno_form', value: name })}>`

/**
 * Sends Lacuno forms without leaving the page, with how long the visitor took: the server takes a
 * post without it, or within three seconds of loading, for a bot's.
 */
export const FORM_SCRIPT = `(() => {
  const loaded = Date.now();
  for (const form of document.querySelectorAll('form[action="/_lacuno/forms"]'))
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = event.submitter;
      const body = new URLSearchParams(new FormData(form));
      body.set('_lacuno_elapsed', String(Date.now() - loaded));
      form.querySelector('[data-lc-alert]')?.remove();
      if (button) button.disabled = true;
      const message = document.createElement('p');
      try {
        const response = await fetch(form.action, { method: 'POST', body });
        if (response.ok) {
          message.textContent = form.dataset.success || 'Thanks! Your message was sent.';
          return form.replaceChildren(message);
        }
        message.textContent = (await response.json()).error;
      } catch {}
      message.textContent ||= "Your message couldn't be sent. Please try again later.";
      message.setAttribute('role', 'alert');
      message.setAttribute('data-lc-alert', '');
      if (button) button.disabled = false;
      button ? button.after(message) : form.append(message);
    });
})();`
