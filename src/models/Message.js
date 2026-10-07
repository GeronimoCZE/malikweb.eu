// Messages sent through the contact form on the home page. Read them in the admin page.
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true
    },

    subject: {
        type: String,
        required: true
    },

    message: {
        type: String,
        required: true
    },

    // Language the visitor was browsing in, so you know which language to reply in.
    language: String,

    read: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

export const message_model =
    mongoose.models.Messages_malikweb ||
    mongoose.model("Messages_malikweb", messageSchema);
