from flask import Flask, render_template, request

app = Flask(__name__)

@app.route("/", methods=["GET", "POST"])
def index():
    final_swarms = 0
    initial = 0
    lands = 0
    if request.method == "POST":
        try:
            initial = int(request.form["initial"])
            lands = int(request.form["lands"])
            final_swarms = initial * (2 ** lands)
        except ValueError:
            final_swarms = "Invalid input. Please enter integers only!"

    return render_template("scuteswarm.html", final_swarms=final_swarms, initial=initial, lands=lands)

if __name__ == "__main__":
    app.run(debug=True)
    app.run(host='0.0.0.0')
