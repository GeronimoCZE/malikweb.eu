// models/project.js
import mongoose from "mongoose";

const projectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },

    thumb_image: {
        type: String,
        required: true
    },

    thumb_description: {
        en: String,
        cs: String
    },

    description: {
        en: String,
        cs: String
    },

    technologies: [{
        type: String
    }],

    images: [{
        url: String,
        alt: {
            en: String,
            cs: String
        }
    }],

    links: [{
        title: String,
        url: String
    }]
}, {
    // Adds createdAt / updatedAt; updatedAt becomes <lastmod> in the sitemap.
    timestamps: true
});

export const project_model =
    mongoose.models.Projects_malikweb ||
    mongoose.model("Projects_malikweb", projectSchema);