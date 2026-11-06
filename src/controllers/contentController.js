'use strict';
// One controller factory serves every simple content type (testimonials, team, events, …).
const { removeUpload } = require('../utils/files');

/**
 * Builds public + admin handlers for a ContentModel.
 * @param {import('../models/ContentModel')} Model
 */
function contentController(Model) {
  const field = Model.imageField;

  return {
    // Public site: active items only
    listPublic(_req, res) {
      res.json({ ok: true, data: Model.allPublic() });
    },

    // Admin: everything
    list(_req, res) {
      res.json({ ok: true, data: Model.all() });
    },

    create(req, res) {
      const { data, error, fields } = Model.validate(req.body, false);
      if (error) { removeUpload(req.file?.filename); return res.status(400).json({ error, fields }); }
      if (field) {
        if (Model.imageRequired && !req.file) return res.status(400).json({ error: 'Please choose an image' });
        if (req.file) data[field] = req.file.filename;
      }
      const row = Model.create(data);
      res.json({ ok: true, id: row.id, data: row });
    },

    update(req, res) {
      const existing = Model.find(req.params.id);
      if (!existing) { removeUpload(req.file?.filename); return res.status(404).json({ error: 'Not found' }); }
      const { data, error, fields } = Model.validate(req.body, true);
      if (error) { removeUpload(req.file?.filename); return res.status(400).json({ error, fields }); }
      const wantsRemoval = field && req.body.remove_image === '1' && !Model.imageRequired;
      if (field && req.file) data[field] = req.file.filename;
      else if (wantsRemoval) data[field] = null;
      const row = Model.update(existing.id, data);
      if (field && (req.file || wantsRemoval)) removeUpload(existing[field]);
      res.json({ ok: true, data: row });
    },

    remove(req, res) {
      const row = Model.remove(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (field) removeUpload(row[field]);
      res.json({ ok: true });
    },
  };
}

module.exports = contentController;
